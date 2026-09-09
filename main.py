import os
import re
import json 
from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from openai import OpenAI
from datetime import datetime, timedelta
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, func
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
import bcrypt
from jose import JWTError, jwt
from pydantic import BaseModel
from typing import Optional, Dict, List
import spacy
import subprocess
import requests


SQLALCHEMY_DATABASE_URL = "sqlite:///./records.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    secret_word = Column(String) 

class Patient(Base):
    __tablename__ = "patients"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    created_at = Column(DateTime, default=datetime.now)
    user_id = Column(Integer, index=True)
    order_index = Column(Integer, default=0)

class ReportRecord(Base):
    __tablename__ = "reports"
    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=datetime.now)
    patient_id = Column(Integer, index=True)
    soap_report = Column(Text) 
    transcription = Column(Text)
    user_id = Column(Integer, index=True)

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

SECRET_KEY = "your-super-secret-key"
ALGORITHM = "HS256"
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

def verify_password(plain_password, hashed_password):
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))

def get_password_hash(password):
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def create_access_token(data: dict):
    to_encode = data.copy()
    to_encode.update({"exp": datetime.utcnow() + timedelta(minutes=60)})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
     
def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="認証に失敗しました")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None: raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = db.query(User).filter(User.username == username).first()
    if user is None: raise credentials_exception
    return user

load_dotenv()
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

print("GiNZAモデルを読み込み中...")
nlp = spacy.load("ja_ginza")
print("読み込み完了！")


@app.post("/register")
def register(username: str = Form(...), password: str = Form(...), secret_word: str = Form(...), db: Session = Depends(get_db)):
    if not re.match(r"^[a-zA-Z0-9_]{4,20}$", username):
        raise HTTPException(status_code=400, detail="IDは4〜20文字の半角英数字で入力してください")
    if len(password) < 8 or not re.search(r"[A-Za-z]", password) or not re.search(r"[0-9]", password):
        raise HTTPException(status_code=400, detail="パスワードは8文字以上で、英字と数字を含めてください")
    if db.query(User).filter(User.username == username).first(): 
        raise HTTPException(status_code=400, detail="すでに登録されているIDです")
        
    db.add(User(username=username, hashed_password=get_password_hash(password), secret_word=secret_word))
    db.commit()
    return {"message": "登録が完了しました"}

@app.post("/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="IDまたはパスワードが間違っています")
    return {"access_token": create_access_token(data={"sub": user.username}), "token_type": "bearer"}

@app.post("/reset_password")
def reset_password(username: str = Form(...), secret_word: str = Form(...), new_password: str = Form(...), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user or user.secret_word != secret_word:
        raise HTTPException(status_code=400, detail="IDまたは秘密の言葉が間違っています")
    if len(new_password) < 8 or not re.search(r"[A-Za-z]", new_password) or not re.search(r"[0-9]", new_password):
        raise HTTPException(status_code=400, detail="新しいパスワードは8文字以上で英数字を含めてください")
        
    user.hashed_password = get_password_hash(new_password)
    db.commit()
    return {"message": "パスワードをリセットしました"}

@app.delete("/users/me")
def delete_account(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.query(ReportRecord).filter(ReportRecord.user_id == current_user.id).delete()
    db.query(Patient).filter(Patient.user_id == current_user.id).delete()
    db.delete(current_user)
    db.commit()
    return {"message": "アカウントを完全に削除しました"}


class PatientCreate(BaseModel): name: str
class ReorderRequest(BaseModel): patient_ids: List[int]

@app.post("/patients")
def create_patient(req: PatientCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    max_order = db.query(func.max(Patient.order_index)).filter(Patient.user_id == current_user.id).scalar() or 0
    new_patient = Patient(name=req.name, user_id=current_user.id, order_index=max_order + 1)
    db.add(new_patient)
    db.commit()
    db.refresh(new_patient)
    return new_patient

@app.get("/patients")
def get_patients(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Patient).filter(Patient.user_id == current_user.id).order_by(Patient.order_index.asc()).all()

@app.put("/patients/reorder")
def reorder_patients(req: ReorderRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    for index, pid in enumerate(req.patient_ids):
        patient = db.query(Patient).filter(Patient.id == pid, Patient.user_id == current_user.id).first()
        if patient: patient.order_index = index
    db.commit()
    return {"message": "並び順を更新しました"}

@app.delete("/patients/{patient_id}")
def delete_patient(patient_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    patient = db.query(Patient).filter(Patient.id == patient_id, Patient.user_id == current_user.id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="患者が見つかりません")
    
    db.query(ReportRecord).filter(ReportRecord.patient_id == patient_id, ReportRecord.user_id == current_user.id).delete()
    db.delete(patient)
    db.commit()
    return {"message": "患者データを削除しました"}

@app.get("/patients/{patient_id}/records")
def get_patient_records(patient_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(ReportRecord).filter(ReportRecord.user_id == current_user.id, ReportRecord.patient_id == patient_id).order_by(ReportRecord.created_at.desc()).all()



@app.post("/transcribe")
def transcribe_audio(audio_file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    temp_webm = f"temp_{audio_file.filename}"
    temp_wav = f"temp_converted.wav"
    with open(temp_webm, "wb+") as f: f.write(audio_file.file.read())
    try: subprocess.run(["ffmpeg", "-y", "-i", temp_webm, "-ar", "16000", "-ac", "1", temp_wav], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        os.remove(temp_webm)
        raise HTTPException(status_code=500, detail="音声変換失敗")
    
    AMIVOICE_APPKEY = os.environ.get("AMIVOICE_APPKEY")
    with open(temp_wav, "rb") as f: response = requests.post("https://acp-api.amivoice.com/v1/recognize", data={"u": AMIVOICE_APPKEY, "d": "-a-medical-input", "loggingOptOut": "True"}, files={"a": f})
    os.remove(temp_webm)
    if os.path.exists(temp_wav): os.remove(temp_wav)
    return {"transcription": response.json().get("text", "")}

class MaskingRequest(BaseModel): text: str; manual_names: Optional[str] = ""
@app.post("/analyze_masking")
def analyze_masking(req: MaskingRequest, current_user: User = Depends(get_current_user)):
    original_text = req.text
    masking_dict, target_words = {}, set()
    if req.manual_names:
        for name in req.manual_names.replace("、", ",").replace(" ", ",").replace(" ", ",").split(","):
            if name.strip():
                target_words.add(name.strip())
                for suffix in ["さん", "様", "先生", "氏"]: target_words.add(f"{name.strip()}{suffix}")
    for ent in nlp(original_text).ents:
        if ent.label_ == "Person": target_words.add(ent.text)
    
    highlighted_text, masked_text = original_text, original_text
    for i, word in enumerate(sorted(list(target_words), key=len, reverse=True)):
        placeholder = f"[対象者{chr(65+i)}]"
        masking_dict[placeholder] = word
        highlighted_text = highlighted_text.replace(word, f"<mark class='bg-yellow-300 text-gray-900 font-bold px-1 mx-1 rounded'>{word}</mark>")
        masked_text = masked_text.replace(word, placeholder)
    return {"original_text": original_text, "highlighted_text": highlighted_text, "masked_text": masked_text, "masking_dict": masking_dict}


class SoapRequest(BaseModel): patient_id: int; masked_text: str; masking_dict: Dict[str, str]; original_text: str
@app.post("/generate_soap")
def generate_soap(req: SoapRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    system_prompt = """
    あなたは訪問看護師のサポートAIです。入力されたテキストから情報を抽出し、必ず以下のJSONフォーマットで出力してください。余計な挨拶や記号は不要。
    {
      "S": "主観的情報（患者の言葉など）",
      "O": "客観的情報（バイタル、観察事項など）",
      "A": "評価・アセスメント",
      "P": "計画・処置"
    }
    """
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        response_format={ "type": "json_object" },
        messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": req.masked_text}]
    )
    
    final_soap_str = response.choices[0].message.content
    for placeholder, real_name in req.masking_dict.items(): 
        final_soap_str = final_soap_str.replace(placeholder, real_name)
        
    db.add(ReportRecord(patient_id=req.patient_id, soap_report=final_soap_str, transcription=req.original_text, user_id=current_user.id))
    db.commit()

    records = db.query(ReportRecord).filter(
        ReportRecord.patient_id == req.patient_id,
        ReportRecord.user_id == current_user.id
    ).order_by(ReportRecord.created_at.desc()).all()
    
    if len(records) > 5:
        for old_record in records[5:]:
            db.delete(old_record)
        db.commit()

    return {"final_soap": final_soap_str}