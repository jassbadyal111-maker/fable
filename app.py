import asyncio
import json
import os
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

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
BASE_URL = os.getenv("EXPLABS_BASE_URL", "https://api.experientiallabs.ai/v1")
FALLBACK_MODELS = [m.strip() for m in os.getenv("FABLE_MODELS", "claude-fable-5").split(",") if m.strip()]
DEFAULT_MODEL = os.getenv("FABLE_DEFAULT_MODEL", FALLBACK_MODELS[0])
DEFAULT_MAX_TOKENS = int(os.getenv("FABLE_MAX_TOKENS", "4096"))
DEFAULT_SYSTEM_PROMPT = os.getenv("FABLE_SYSTEM_PROMPT", "You are Fable, a helpful AI assistant. Be direct, accurate, and conversational.")
if not API_KEY:
    raise RuntimeError("EXPLABS_API_KEY is missing. Put it in .env")
client = OpenAI(base_url=BASE_URL, api_key=API_KEY)
app = FastAPI(title="Fable Chat")


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
        conn.commit()
init_db()

def now(): return datetime.now(timezone.utc).isoformat()
def create_chat(model=DEFAULT_MODEL):
    chat_id, timestamp = str(uuid.uuid4()), now()
    with closing(db()) as conn:
        conn.execute("INSERT INTO chats(id,title,model,created_at,updated_at) VALUES(?,?,?,?,?)", (chat_id,"New chat",model,timestamp,timestamp)); conn.commit()
    return chat_id

def ensure_chat(chat_id):
    with closing(db()) as conn: row = conn.execute("SELECT * FROM chats WHERE id=?", (chat_id,)).fetchone()
    if not row: raise HTTPException(404,"Chat not found")
    return row

def discover_models():
    try:
        result = client.models.list()
        ids = [getattr(m, "id", None) for m in result.data]
        ids = [m for m in ids if m]
        return ids or FALLBACK_MODELS
    except Exception:
        return FALLBACK_MODELS

class ChatCreate(BaseModel): model: str | None = None
class ChatRename(BaseModel): title: str
class MessageCreate(BaseModel):
    content: str
    model: str | None = None
    max_tokens: int | None = Field(default=None, ge=1, le=200000)
    system_prompt: str | None = None

@app.get("/api/config")
def config():
    models = discover_models()
    default = DEFAULT_MODEL if DEFAULT_MODEL in models else models[0]
    return {"models": models, "default_model": default, "default_max_tokens": DEFAULT_MAX_TOKENS, "default_system_prompt": DEFAULT_SYSTEM_PROMPT}

@app.get("/api/chats")
def chats():
    with closing(db()) as conn: rows = conn.execute("SELECT id,title,model,created_at,updated_at FROM chats ORDER BY updated_at DESC").fetchall()
    return [dict(row) for row in rows]

@app.post("/api/chats")
def new_chat(payload: ChatCreate):
    models = discover_models(); model = payload.model or DEFAULT_MODEL
    if model not in models: raise HTTPException(400,"Unsupported model")
    chat_id = create_chat(model); return {"id":chat_id,"title":"New chat","model":model}

@app.get("/api/chats/{chat_id}")
def get_chat(chat_id: str):
    chat = ensure_chat(chat_id)
    with closing(db()) as conn: messages = conn.execute("SELECT id,role,content,created_at FROM messages WHERE chat_id=? ORDER BY id", (chat_id,)).fetchall()
    return {"chat":dict(chat),"messages":[dict(m) for m in messages]}

@app.patch("/api/chats/{chat_id}")
def rename_chat(chat_id: str, payload: ChatRename):
    ensure_chat(chat_id); title=payload.title.strip()[:100]
    if not title: raise HTTPException(400,"Title cannot be empty")
    with closing(db()) as conn: conn.execute("UPDATE chats SET title=?,updated_at=? WHERE id=?",(title,now(),chat_id)); conn.commit()
    return {"id":chat_id,"title":title}

@app.delete("/api/chats/{chat_id}")
def delete_chat(chat_id: str):
    ensure_chat(chat_id)
    with closing(db()) as conn: conn.execute("DELETE FROM messages WHERE chat_id=?",(chat_id,)); conn.execute("DELETE FROM chats WHERE id=?",(chat_id,)); conn.commit()
    return JSONResponse({"ok":True})

@app.post("/api/chats/{chat_id}/messages")
async def stream_message(chat_id: str, payload: MessageCreate, request: Request):
    chat=ensure_chat(chat_id); content=payload.content.strip()
    if not content: raise HTTPException(400,"Message cannot be empty")
    models=discover_models(); model=payload.model or chat["model"]
    if model not in models: raise HTTPException(400,"Unsupported model")
    max_tokens=payload.max_tokens or DEFAULT_MAX_TOKENS
    system_prompt=(payload.system_prompt or DEFAULT_SYSTEM_PROMPT).strip()[:20000]
    timestamp=now()
    with closing(db()) as conn:
        count=conn.execute("SELECT COUNT(*) AS n FROM messages WHERE chat_id=?",(chat_id,)).fetchone()["n"]
        conn.execute("INSERT INTO messages(chat_id,role,content,created_at) VALUES(?,?,?,?)",(chat_id,"user",content,timestamp))
        title=content.replace("\n"," ").strip()[:45] or "New chat"
        conn.execute("UPDATE chats SET title=?,model=?,updated_at=? WHERE id=?",(title if count==0 else chat["title"],model,timestamp,chat_id)); conn.commit()
        history_rows=conn.execute("SELECT role,content FROM messages WHERE chat_id=? ORDER BY id",(chat_id,)).fetchall()
    messages=[{"role":"system","content":system_prompt}]+[{"role":r["role"],"content":r["content"]} for r in history_rows]

    async def event_stream():
        answer_parts=[]; stream=None
        try:
            stream=await asyncio.to_thread(client.chat.completions.create,model=model,stream=True,messages=messages,max_tokens=max_tokens)
            for chunk in stream:
                if await request.is_disconnected(): break
                if not chunk.choices: continue
                text=getattr(chunk.choices[0].delta,"content",None)
                if text:
                    answer_parts.append(text); yield f"data: {json.dumps({'type':'token','text':text})}\n\n"; await asyncio.sleep(0)
            answer="".join(answer_parts)
            if answer:
                with closing(db()) as conn:
                    conn.execute("INSERT INTO messages(chat_id,role,content,created_at) VALUES(?,?,?,?)",(chat_id,"assistant",answer,now())); conn.execute("UPDATE chats SET updated_at=? WHERE id=?",(now(),chat_id)); conn.commit()
            yield f"data: {json.dumps({'type':'done','content':answer})}\n\n"
        except Exception as exc: yield f"data: {json.dumps({'type':'error','message':str(exc)})}\n\n"
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
