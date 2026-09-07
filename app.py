import asyncio
import json
import os
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request as UrlRequest, urlopen

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from openai import OpenAI
from pydantic import BaseModel, Field

load_dotenv()
BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "fable.db"
WEB_DIR = BASE_DIR / "web"
API_KEY = os.getenv("EXPLABS_API_KEY")
BASE_URL = os.getenv("EXPLABS_BASE_URL", "https://api.experientiallabs.ai/v1").rstrip("/")
CATALOG_URL = os.getenv("EXPLABS_CATALOG_URL", "https://api.experientiallabs.ai/api").rstrip("/")
FALLBACK_MODELS = [m.strip() for m in os.getenv("FABLE_MODELS", "claude-fable-5.1").split(",") if m.strip()]
DEFAULT_MODEL = os.getenv("FABLE_DEFAULT_MODEL", FALLBACK_MODELS[0])
DEFAULT_MAX_TOKENS = int(os.getenv("FABLE_MAX_TOKENS", "4096"))
DEFAULT_SYSTEM_PROMPT = os.getenv("FABLE_SYSTEM_PROMPT", "You are Fable, a helpful AI assistant. Be direct, accurate, and conversational.")
if not API_KEY:
    raise RuntimeError("EXPLABS_API_KEY is missing. Put it in .env")
client = OpenAI(base_url=BASE_URL, api_key=API_KEY)
app = FastAPI(title="Fable Chat")
_catalog_cache = {"items": {}}


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with closing(db()) as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY,title TEXT NOT NULL,model TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE);
        CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id,id);
        """)
        columns = {row[1] for row in conn.execute("PRAGMA table_info(messages)").fetchall()}
        if "reasoning_summary" not in columns:
            conn.execute("ALTER TABLE messages ADD COLUMN reasoning_summary TEXT NOT NULL DEFAULT ''")
        conn.commit()


init_db()


def now():
    return datetime.now(timezone.utc).isoformat()


def create_chat(model=DEFAULT_MODEL):
    chat_id, timestamp = str(uuid.uuid4()), now()
    with closing(db()) as conn:
        conn.execute("INSERT INTO chats(id,title,model,created_at,updated_at) VALUES(?,?,?,?,?)", (chat_id, "New chat", model, timestamp, timestamp))
        conn.commit()
    return chat_id


def ensure_chat(chat_id):
    with closing(db()) as conn:
        row = conn.execute("SELECT * FROM chats WHERE id=?", (chat_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Chat not found")
    return row


def discover_models():
    try:
        result = client.models.list()
        ids = [getattr(m, "id", None) for m in result.data]
        return [m for m in ids if m] or FALLBACK_MODELS
    except Exception:
        return FALLBACK_MODELS


def catalog_detail(slug):
    import time
    cached = _catalog_cache["items"].get(slug)
    if cached and time.time() - cached[0] < 300:
        return cached[1]
    url = f"{CATALOG_URL}/models/{slug}"
    for headers in ({"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"}, {"Accept": "application/json"}):
        try:
            req = UrlRequest(url, headers=headers)
            with urlopen(req, timeout=8) as response:
                data = json.loads(response.read().decode("utf-8"))
            _catalog_cache["items"][slug] = (time.time(), data)
            return data
        except Exception:
            continue
    return None


def normalize_model(slug):
    raw = catalog_detail(slug) or {}
    params = raw.get("supported_params") or raw.get("supported_parameters") or raw.get("parameters") or {}
    if isinstance(params, list):
        params = {str(x): True for x in params}
    reasoning = raw.get("reasoning")
    if isinstance(reasoning, dict):
        reasoning_levels = reasoning.get("levels") or reasoning.get("effort_levels") or []
        reasoning_default = reasoning.get("default")
        reasoning_supported = bool(reasoning.get("supported"))
    elif isinstance(reasoning, list):
        reasoning_levels = reasoning
        reasoning_default = None
        reasoning_supported = True
    else:
        reasoning_levels = raw.get("reasoning_levels") or []
        reasoning_default = raw.get("reasoning_default")
        reasoning_supported = False
    # Never invent effort choices. The setting appears only when the catalog explicitly exposes levels.
    reasoning_levels = [str(x).lower() for x in reasoning_levels if str(x).strip()]
    supports_reasoning = bool(reasoning_levels) and (reasoning_supported or "reasoning_effort" in params or "reasoning" in params or isinstance(reasoning, (dict, list)))
    max_output = raw.get("max_output") or raw.get("max_output_tokens") or (raw.get("limits") or {}).get("max_output") or (raw.get("limits") or {}).get("max_output_tokens") or DEFAULT_MAX_TOKENS
    try:
        max_output = int(max_output)
    except (TypeError, ValueError):
        max_output = DEFAULT_MAX_TOKENS
    if reasoning_default is None and reasoning_levels:
        reasoning_default = "medium" if "medium" in reasoning_levels else reasoning_levels[0]
    return {"id": slug, "name": raw.get("display_name") or raw.get("name") or slug, "max_output": max_output, "reasoning": supports_reasoning, "reasoning_levels": reasoning_levels if supports_reasoning else [], "reasoning_default": str(reasoning_default).lower() if reasoning_default else None, "catalog_url": f"https://platform.experientiallabs.ai/models/{slug}"}


class ChatCreate(BaseModel):
    model: str | None = None


class ChatRename(BaseModel):
    title: str


class MessageCreate(BaseModel):
    content: str
    model: str | None = None
    max_tokens: int | None = Field(default=None, ge=1, le=500000)
    system_prompt: str | None = None
    reasoning_effort: str | None = None


@app.get("/api/config")
def config():
    ids = discover_models()
    # Do not fetch hundreds of catalog detail pages here. Capabilities are loaded lazily for the selected model.
    models = [{"id": slug, "name": slug, "max_output": DEFAULT_MAX_TOKENS, "reasoning": False, "reasoning_levels": [], "reasoning_default": None} for slug in ids]
    default = DEFAULT_MODEL if DEFAULT_MODEL in ids else ids[0]
    return {"models": models, "default_model": default, "default_max_tokens": DEFAULT_MAX_TOKENS, "default_system_prompt": DEFAULT_SYSTEM_PROMPT}


@app.get("/api/model/{slug}")
def model_config(slug: str):
    if slug not in discover_models():
        raise HTTPException(404, "Model not available")
    return normalize_model(slug)


@app.get("/api/chats")
def chats():
    with closing(db()) as conn:
        rows = conn.execute("SELECT id,title,model,created_at,updated_at FROM chats ORDER BY updated_at DESC").fetchall()
    return [dict(row) for row in rows]


@app.post("/api/chats")
def new_chat(payload: ChatCreate):
    models = discover_models(); model = payload.model or DEFAULT_MODEL
    if model not in models:
        raise HTTPException(400, "Unsupported model")
    return {"id": create_chat(model), "title": "New chat", "model": model}


@app.get("/api/chats/{chat_id}")
def get_chat(chat_id: str):
    chat = ensure_chat(chat_id)
    with closing(db()) as conn:
        messages = conn.execute("SELECT id,role,content,reasoning_summary,created_at FROM messages WHERE chat_id=? ORDER BY id", (chat_id,)).fetchall()
    return {"chat": dict(chat), "messages": [dict(m) for m in messages]}


@app.patch("/api/chats/{chat_id}")
def rename_chat(chat_id: str, payload: ChatRename):
    ensure_chat(chat_id); title = payload.title.strip()[:100]
    if not title:
        raise HTTPException(400, "Title cannot be empty")
    with closing(db()) as conn:
        conn.execute("UPDATE chats SET title=?,updated_at=? WHERE id=?", (title, now(), chat_id)); conn.commit()
    return {"id": chat_id, "title": title}


@app.delete("/api/chats/{chat_id}")
def delete_chat(chat_id: str):
    ensure_chat(chat_id)
    with closing(db()) as conn:
        conn.execute("DELETE FROM messages WHERE chat_id=?", (chat_id,)); conn.execute("DELETE FROM chats WHERE id=?", (chat_id,)); conn.commit()
    return JSONResponse({"ok": True})


@app.post("/api/chats/{chat_id}/messages")
async def stream_message(chat_id: str, payload: MessageCreate, request: Request):
    chat = ensure_chat(chat_id); content = payload.content.strip()
    if not content:
        raise HTTPException(400, "Message cannot be empty")
    models = discover_models(); model = payload.model or chat["model"]
    if model not in models:
        raise HTTPException(400, "Unsupported model")
    capability = normalize_model(model)
    max_tokens = min(payload.max_tokens or capability["max_output"], capability["max_output"])
    system_prompt = (payload.system_prompt or DEFAULT_SYSTEM_PROMPT).strip()[:20000]
    effort = (payload.reasoning_effort or "").lower().strip()
    allowed_efforts = capability["reasoning_levels"]
    if effort and (not capability["reasoning"] or effort not in allowed_efforts):
        raise HTTPException(400, "Reasoning effort is not supported by this model")
    timestamp = now()
    with closing(db()) as conn:
        count = conn.execute("SELECT COUNT(*) AS n FROM messages WHERE chat_id=?", (chat_id,)).fetchone()["n"]
        conn.execute("INSERT INTO messages(chat_id,role,content,reasoning_summary,created_at) VALUES(?,?,?,?,?)", (chat_id, "user", content, "", timestamp))
        title = content.replace("\n", " ").strip()[:45] or "New chat"
        conn.execute("UPDATE chats SET title=?,model=?,updated_at=? WHERE id=?", (title if count == 0 else chat["title"], model, timestamp, chat_id)); conn.commit()
        history_rows = conn.execute("SELECT role,content FROM messages WHERE chat_id=? ORDER BY id", (chat_id,)).fetchall()
    messages = [{"role": "system", "content": system_prompt}] + [{"role": r["role"], "content": r["content"]} for r in history_rows]

    async def event_stream():
        answer_parts=[]; reasoning_summary_parts=[]; stream=None
        try:
            kwargs={"model":model,"stream":True,"messages":messages,"max_tokens":max_tokens}
            if effort:
                kwargs["reasoning_effort"]=effort
            stream=await asyncio.to_thread(client.chat.completions.create, **kwargs)
            for chunk in stream:
                if await request.is_disconnected(): break
                if not chunk.choices: continue
                delta=chunk.choices[0].delta
                text=getattr(delta,"content",None)
                summary=getattr(delta,"reasoning_summary",None) or getattr(delta,"summary",None)
                if summary:
                    reasoning_summary_parts.append(summary)
                    yield f"data: {json.dumps({'type':'reasoning_summary','text':summary})}\n\n"
                if text:
                    answer_parts.append(text)
                    yield f"data: {json.dumps({'type':'token','text':text})}\n\n"
                await asyncio.sleep(0)
            answer="".join(answer_parts); reasoning_summary="".join(reasoning_summary_parts)
            if answer:
                with closing(db()) as conn:
                    conn.execute("INSERT INTO messages(chat_id,role,content,reasoning_summary,created_at) VALUES(?,?,?,?,?)", (chat_id,"assistant",answer,reasoning_summary,now()))
                    conn.execute("UPDATE chats SET updated_at=? WHERE id=?",(now(),chat_id)); conn.commit()
            yield f"data: {json.dumps({'type':'done','content':answer,'reasoning_summary':reasoning_summary})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type':'error','message':str(exc)})}\n\n"
        finally:
            try:
                if stream is not None: stream.close()
            except Exception: pass
    return StreamingResponse(event_stream(),media_type="text/event-stream",headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})


@app.get("/manifest.webmanifest")
def manifest(): return FileResponse(WEB_DIR/"manifest.webmanifest",media_type="application/manifest+json")
@app.get("/sw.js")
def service_worker(): return FileResponse(WEB_DIR/"sw.js",media_type="application/javascript")
@app.get("/{path:path}")
def frontend(path: str=""):
    requested=WEB_DIR/path
    if path and requested.is_file(): return FileResponse(requested)
    return FileResponse(WEB_DIR/"index.html")
