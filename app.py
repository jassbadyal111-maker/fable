import json, os, sqlite3, time, uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request, send_from_directory

load_dotenv()
BASE_DIR=Path(__file__).resolve().parent
DB_PATH=BASE_DIR/'fable.db'
WEB_DIR=BASE_DIR/'web'
API_KEY=os.getenv('EXPLABS_API_KEY')
BASE_URL=os.getenv('EXPLABS_BASE_URL','https://api.experientiallabs.ai/v1').rstrip('/')
CATALOG_URL=os.getenv('EXPLABS_CATALOG_URL','https://api.experientiallabs.ai/api').rstrip('/')
FALLBACK_MODELS=[x.strip() for x in os.getenv('FABLE_MODELS','claude-fable-5.1').split(',') if x.strip()]
DEFAULT_MODEL=os.getenv('FABLE_DEFAULT_MODEL',FALLBACK_MODELS[0])
DEFAULT_MAX_TOKENS=int(os.getenv('FABLE_MAX_TOKENS','4096'))
DEFAULT_SYSTEM_PROMPT=os.getenv('FABLE_SYSTEM_PROMPT','You are Fable, a helpful AI assistant. Be direct, accurate, and conversational.')
if not API_KEY: raise RuntimeError('EXPLABS_API_KEY is missing. Put it in .env')
app=Flask(__name__,static_folder=str(WEB_DIR),static_url_path='')
session=requests.Session();model_cache={'at':0,'ids':[]};catalog_cache={}

def db():
    c=sqlite3.connect(DB_PATH);c.row_factory=sqlite3.Row;return c

def now():return datetime.now(timezone.utc).isoformat()
def api_headers():return {'Authorization':f'Bearer {API_KEY}','Accept':'application/json','Content-Type':'application/json'}

def init_db():
    with closing(db()) as c:
        c.executescript('CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY,title TEXT NOT NULL,model TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id,id);')
        if 'reasoning_summary' not in {r[1] for r in c.execute('PRAGMA table_info(messages)')}:c.execute("ALTER TABLE messages ADD COLUMN reasoning_summary TEXT NOT NULL DEFAULT ''")
        c.commit()
init_db()

def discover_models():
    if model_cache['ids'] and time.time()-model_cache['at']<60:return model_cache['ids']
    try:
        r=session.get(f'{BASE_URL}/models',headers=api_headers(),timeout=12);r.raise_for_status();data=r.json();items=data.get('data',data if isinstance(data,list) else [])
        ids=[str(x['id']) for x in items if isinstance(x,dict) and x.get('id')]
        if ids:model_cache.update(at=time.time(),ids=ids);return ids
    except requests.RequestException:pass
    return FALLBACK_MODELS

def unwrap_catalog(data):
    value=data
    for _ in range(3):
        if not isinstance(value,dict):break
        for key in ('data','model','result'):
            nested=value.get(key)
            if isinstance(nested,dict) and nested is not value:value=nested;break
        else:break
    return value if isinstance(value,dict) else {}

def catalog_detail(slug):
    cached=catalog_cache.get(slug)
    if cached and time.time()-cached[0]<300:return cached[1]
    try:
        r=session.get(f'{CATALOG_URL}/models/{slug}',headers=api_headers(),timeout=10)
        if r.ok:
            data=unwrap_catalog(r.json());catalog_cache[slug]=(time.time(),data);return data
    except requests.RequestException:pass
    return {}

def first_int(*values):
    for v in values:
        if isinstance(v,dict):
            for k in ('value','max','limit','tokens','output','max_output','max_output_tokens'):
                if k in v:
                    n=first_int(v.get(k))
                    if n:return n
        try:
            if isinstance(v,str):
                s=v.strip().lower().replace(',','')
                if s.endswith('k'):n=int(float(s[:-1])*1000)
                elif s.endswith('m'):n=int(float(s[:-1])*1000000)
                else:n=int(float(s))
            else:n=int(v)
            if n>0:return n
        except (TypeError,ValueError):pass
    return DEFAULT_MAX_TOKENS

def normalize_model(slug):
    raw=catalog_detail(slug);limits=raw.get('limits') if isinstance(raw.get('limits'),dict) else {};limit=raw.get('limit') if isinstance(raw.get('limit'),dict) else {}
    max_output=first_int(raw.get('max_output'),raw.get('max_output_tokens'),raw.get('max_tokens'),limits.get('max_output'),limits.get('max_output_tokens'),limits.get('max_tokens'),limit.get('output'),limit.get('max_output'),limit.get('max_tokens'),raw.get('max_output_limit'),raw.get('output_limit'),DEFAULT_MAX_TOKENS)
    context=first_int(raw.get('context'),raw.get('context_window'),raw.get('max_context'),limits.get('context'),limits.get('context_window'),limit.get('context'),limit.get('context_window'))
    return {'id':slug,'name':raw.get('display_name') or raw.get('name') or slug,'max_output':max_output,'context':context,'reasoning':False,'reasoning_levels':[],'reasoning_default':None,'catalog_url':f'https://platform.experientiallabs.ai/models/{slug}'}

def create_chat(model):
    cid=str(uuid.uuid4());t=now()
    with closing(db()) as c:c.execute('INSERT INTO chats VALUES(?,?,?,?,?)',(cid,'New chat',model,t,t));c.commit()
    return cid

def get_chat_row(cid):
    with closing(db()) as c:return c.execute('SELECT * FROM chats WHERE id=?',(cid,)).fetchone()
def sse(obj):return 'data: '+json.dumps(obj,ensure_ascii=False)+'\n\n'

@app.get('/api/config')
def config():
    ids=discover_models();models=[{'id':x,'name':x,'max_output':DEFAULT_MAX_TOKENS,'reasoning':False,'reasoning_levels':[],'reasoning_default':None} for x in ids];default=DEFAULT_MODEL if DEFAULT_MODEL in ids else ids[0]
    return jsonify(models=models,default_model=default,default_max_tokens=DEFAULT_MAX_TOKENS,default_system_prompt=DEFAULT_SYSTEM_PROMPT)

@app.get('/api/model/<path:slug>')
def model_config(slug):
    if slug not in discover_models():return jsonify(error='Model not available'),404
    return jsonify(normalize_model(slug))

@app.get('/api/chats')
def chats():
    with closing(db()) as c:rows=c.execute('SELECT id,title,model,created_at,updated_at FROM chats ORDER BY updated_at DESC').fetchall()
    return jsonify([dict(x) for x in rows])

@app.post('/api/chats')
def new_chat():
    p=request.get_json(silent=True) or {};model=p.get('model') or DEFAULT_MODEL
    if model not in discover_models():return jsonify(error='Unsupported model'),400
    return jsonify(id=create_chat(model),title='New chat',model=model)

@app.get('/api/chats/<cid>')
def chat(cid):
    row=get_chat_row(cid)
    if not row:return jsonify(error='Chat not found'),404
    with closing(db()) as c:msgs=c.execute('SELECT id,role,content,created_at FROM messages WHERE chat_id=? ORDER BY id',(cid,)).fetchall()
    return jsonify(chat=dict(row),messages=[dict(x) for x in msgs])

@app.patch('/api/chats/<cid>')
def rename(cid):
    if not get_chat_row(cid):return jsonify(error='Chat not found'),404
    title=str((request.get_json(silent=True) or {}).get('title','')).strip()[:100]
    if not title:return jsonify(error='Title cannot be empty'),400
    with closing(db()) as c:c.execute('UPDATE chats SET title=?,updated_at=? WHERE id=?',(title,now(),cid));c.commit()
    return jsonify(id=cid,title=title)

@app.delete('/api/chats/<cid>')
def delete(cid):
    if not get_chat_row(cid):return jsonify(error='Chat not found'),404
    with closing(db()) as c:c.execute('DELETE FROM messages WHERE chat_id=?',(cid,));c.execute('DELETE FROM chats WHERE id=?',(cid,));c.commit()
    return jsonify(ok=True)

@app.post('/api/chats/<cid>/messages')
def stream_message(cid):
    chat=get_chat_row(cid)
    if not chat:return jsonify(error='Chat not found'),404
    p=request.get_json(silent=True) or {};content=str(p.get('content','')).strip()
    if not content:return jsonify(error='Message cannot be empty'),400
    model=p.get('model') or chat['model']
    if model not in discover_models():return jsonify(error='Unsupported model'),400
    cap=normalize_model(model)
    try:requested=int(p.get('max_tokens') or cap['max_output'])
    except (TypeError,ValueError):requested=cap['max_output']
    max_tokens=min(max(1,requested),cap['max_output'])
    system=str(p.get('system_prompt') or DEFAULT_SYSTEM_PROMPT).strip()[:20000];t=now()
    with closing(db()) as c:
        count=c.execute('SELECT COUNT(*) n FROM messages WHERE chat_id=?',(cid,)).fetchone()['n']
        c.execute('INSERT INTO messages(chat_id,role,content,reasoning_summary,created_at) VALUES(?,?,?,?,?)',(cid,'user',content,'',t))
        title=content.replace('\n',' ').strip()[:45] or 'New chat';c.execute('UPDATE chats SET title=?,model=?,updated_at=? WHERE id=?',(title if count==0 else chat['title'],model,t,cid));c.commit()
        history=c.execute('SELECT role,content FROM messages WHERE chat_id=? ORDER BY id',(cid,)).fetchall()
    messages=[{'role':'system','content':system}]+[{'role':x['role'],'content':x['content']} for x in history]
    provider={'model':model,'stream':True,'messages':messages,'max_tokens':max_tokens}
    def generate():
        answer=[];upstream=None
        try:
            upstream=session.post(f'{BASE_URL}/chat/completions',headers=api_headers(),json=provider,stream=True,timeout=(15,900))
            if not upstream.ok:
                try:detail=upstream.json()
                except ValueError:detail=upstream.text
                yield sse({'type':'error','message':str(detail)});return
            for raw in upstream.iter_lines(decode_unicode=True):
                if not raw:continue
                line=raw.strip()
                if line.startswith('data:'):line=line[5:].strip()
                if line=='[DONE]':break
                try:chunk=json.loads(line)
                except json.JSONDecodeError:continue
                choices=chunk.get('choices') or []
                if not choices:continue
                delta=choices[0].get('delta') or {};text=delta.get('content')
                if text:answer.append(str(text));yield sse({'type':'token','text':str(text)})
            final=''.join(answer)
            if final:
                with closing(db()) as c:c.execute('INSERT INTO messages(chat_id,role,content,reasoning_summary,created_at) VALUES(?,?,?,?,?)',(cid,'assistant',final,'',now()));c.execute('UPDATE chats SET updated_at=? WHERE id=?',(now(),cid));c.commit()
            yield sse({'type':'done','content':final})
        except GeneratorExit:raise
        except requests.RequestException as e:yield sse({'type':'error','message':f'Provider request failed: {e}'})
        except Exception as e:yield sse({'type':'error','message':str(e)})
        finally:
            if upstream is not None:upstream.close()
    return Response(generate(),mimetype='text/event-stream',headers={'Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no','Connection':'keep-alive'})

@app.get('/api/health')
def health():return jsonify(ok=True,service='fable',provider=BASE_URL)
@app.route('/manifest.webmanifest')
def manifest():return send_from_directory(WEB_DIR,'manifest.webmanifest',mimetype='application/manifest+json')
@app.route('/sw.js')
def sw():return send_from_directory(WEB_DIR,'sw.js',mimetype='application/javascript')
@app.route('/',defaults={'path':''})
@app.route('/<path:path>')
def frontend(path):
    if path and (WEB_DIR/path).is_file():return send_from_directory(WEB_DIR,path)
    return send_from_directory(WEB_DIR,'index.html')

if __name__=='__main__':app.run(host='0.0.0.0',port=int(os.getenv('PORT','8000')),debug=os.getenv('FLASK_DEBUG','0')=='1',threaded=True)
