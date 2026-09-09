"use client";
import { useState, useRef, useEffect } from "react";

type Patient = { id: number; name: string };
type Record = { id: number; created_at: string; soap_report: string; transcription: string };

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register" | "forgot">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [secretWord, setSecretWord] = useState(""); 
  const [authError, setAuthError] = useState("");

  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [newPatientName, setNewPatientName] = useState("");
  const [records, setRecords] = useState<Record[]>([]);
  const [activeTab, setActiveTab] = useState<"history" | "record">("history");
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [transcribedText, setTranscribedText] = useState("");
  const [manualNames, setManualNames] = useState("");
  const [highlightedText, setHighlightedText] = useState("");
  const [maskedText, setMaskedText] = useState("");
  const [maskingDict, setMaskingDict] = useState({});
  const [finalSoap, setFinalSoap] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  const API_BASE = "/api";

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    if ((authMode === "register" || authMode === "forgot") && password !== confirmPassword) {
      setAuthError("パスワードと確認用パスワードが一致しません"); return;
    }
    try {
      const formData = new URLSearchParams(); formData.append("username", username);
      let endpoint = "/login";
      if (authMode === "register") { endpoint = "/register"; formData.append("password", password); formData.append("secret_word", secretWord); }
      else if (authMode === "forgot") { endpoint = "/reset_password"; formData.append("secret_word", secretWord); formData.append("new_password", password); }
      else { formData.append("password", password); }
      const res = await fetch(`${API_BASE}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formData.toString() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "エラーが発生しました");
      if (authMode === "login") { setToken(data.access_token); }
      else { alert(authMode === "register" ? "登録完了！ログインしてください。" : "パスワードをリセットしました！"); setAuthMode("login"); setPassword(""); setConfirmPassword(""); setSecretWord(""); }
    } catch (error: any) { setAuthError(error.message); }
  };

  const handleLogout = () => {
    setToken(null); setUsername(""); setPassword(""); setConfirmPassword(""); setSecretWord(""); setPatients([]);
    setSelectedPatient(null); setRecords([]); setActiveTab("history");
    setTranscribedText(""); setManualNames(""); setHighlightedText(""); setMaskedText(""); setMaskingDict({}); setFinalSoap("");
  };

  const fetchPatients = async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/patients`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setPatients(await res.json());
  };

  const handleAddPatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPatientName.trim()) return;
    const res = await fetch(`${API_BASE}/patients`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: newPatientName }), });
    if (res.ok) { setNewPatientName(""); fetchPatients(); }
  };

  const fetchRecords = async (patientId: number) => {
    const res = await fetch(`${API_BASE}/patients/${patientId}/records`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setRecords(await res.json());
  };

  useEffect(() => { if (token) fetchPatients(); }, [token]);
  useEffect(() => { if (selectedPatient) { fetchRecords(selectedPatient.id); setActiveTab("history"); setManualNames(selectedPatient.name); setTranscribedText(""); setFinalSoap(""); } }, [selectedPatient]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder; audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        setIsLoading(true);
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const formData = new FormData(); formData.append("audio_file", audioBlob, "recording.webm");
        try {
          const res = await fetch(`${API_BASE}/transcribe`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData });
          const data = await res.json(); setTranscribedText(data.transcription);
        } catch (error) { alert("文字起こし失敗"); } finally { setIsLoading(false); }
      };
      mediaRecorder.start(); setIsRecording(true);
    } catch (error) { alert("マイクのアクセスが許可されていません"); }
  };
  const stopRecording = () => { mediaRecorderRef.current?.stop(); setIsRecording(false); };

  const analyzeText = async () => {
    if (!transcribedText) { setHighlightedText(""); setMaskedText(""); return; }
    const res = await fetch(`${API_BASE}/analyze_masking`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ text: transcribedText, manual_names: manualNames }), });
    const data = await res.json();
    setHighlightedText(data.highlighted_text); setMaskedText(data.masked_text); setMaskingDict(data.masking_dict);
  };
  useEffect(() => { const timer = setTimeout(() => { analyzeText(); }, 500); return () => clearTimeout(timer); }, [transcribedText, manualNames]);

  const handleGenerateSoap = async () => {
    if (!selectedPatient) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/generate_soap`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ patient_id: selectedPatient.id, masked_text: maskedText, masking_dict: maskingDict, original_text: transcribedText }), });
      const data = await res.json(); setFinalSoap(data.final_soap); fetchRecords(selectedPatient.id);
    } catch (error) { alert("SOAP生成失敗"); } finally { setIsLoading(false); }
  };

  const SoapDisplay = ({ soapStr }: { soapStr: string }) => {
    let soapData: any = {};
    try { soapData = JSON.parse(soapStr); } catch (e) { soapData = { "テキスト": soapStr }; }
    return (
      <div className="flex flex-col gap-3">
        {Object.entries(soapData).map(([key, value]) => (
          <div key={key} className="bg-white border border-blue-200 rounded-lg p-3 shadow-sm relative group">
            <div className="flex justify-between items-center mb-2">
              <span className="font-bold text-blue-900 text-sm">{key}</span>
              <button onClick={() => { navigator.clipboard.writeText(String(value)); alert(`${key} をコピーしました！`); }} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 py-1 px-3 rounded border border-gray-300"> コピー</button>
            </div>
            <p className="text-gray-800 whitespace-pre-wrap text-sm">{String(value)}</p>
          </div>
        ))}
      </div>
    );
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-blue-50 flex items-center justify-center p-4">
        <style>{`body { background-color: #eff6ff; }`}</style>
        <div className="bg-white p-6 md:p-8 rounded-2xl shadow-lg w-full max-w-md">
          <h1 className="text-xl md:text-2xl font-bold text-center text-blue-900 mb-6">{authMode === "login" ? "ログイン" : authMode === "register" ? "新規登録" : "パスワードリセット"}</h1>
          {authError && <div className="bg-red-100 text-red-600 p-3 rounded mb-4 text-sm font-bold">{authError}</div>}
          <form onSubmit={handleAuth} className="flex flex-col gap-4">
            <input type="text" placeholder="ID (英数字4文字以上)" value={username} onChange={(e) => setUsername(e.target.value)} className="border p-3 rounded text-sm" required />
            {(authMode === "register" || authMode === "forgot") && <input type="text" placeholder="秘密の言葉" value={secretWord} onChange={(e) => setSecretWord(e.target.value)} className="border p-3 rounded bg-yellow-50 text-sm" required />}
            <input type="password" placeholder="パスワード (8文字以上)" value={password} onChange={(e) => setPassword(e.target.value)} className="border p-3 rounded text-sm" required />
            {(authMode === "register" || authMode === "forgot") && <input type="password" placeholder="パスワード（確認用）" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="border p-3 rounded bg-gray-50 text-sm" required />}
            <button type="submit" className="bg-blue-600 text-white font-bold py-3 rounded hover:bg-blue-700 text-sm">{authMode === "login" ? "ログイン" : authMode === "register" ? "登録する" : "変更する"}</button>
          </form>
          <div className="mt-6 flex flex-col gap-2 text-sm text-center">
            {authMode !== "login" && <button onClick={() => { setAuthMode("login"); setAuthError(""); }} className="text-blue-500">ログインへ戻る</button>}
            {authMode === "login" && <><button onClick={() => { setAuthMode("register"); setAuthError(""); }} className="text-blue-500">新規登録</button><button onClick={() => { setAuthMode("forgot"); setAuthError(""); }} className="text-gray-500 text-xs mt-2">パスワードを忘れた</button></>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden relative">
      <style>{`body { background-color: #f3f4f6; }`}</style>
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-gray-500 bg-opacity-30 backdrop-blur-sm z-40 md:hidden transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        ></div>
      )}

      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 flex flex-col shadow-xl transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"} shrink-0`}>
        <div className="p-4 bg-blue-900 text-white flex flex-col gap-1 shrink-0">
          <div className="flex justify-between items-center">
            <h1 className="font-bold text-base tracking-wider">患者リスト</h1>
            <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-white font-bold text-xl px-2">×</button>
          </div>
        </div>
        <div className="p-3 border-b border-gray-100 bg-gray-50 shrink-0">
          <form onSubmit={handleAddPatient} className="flex gap-2">
            <input type="text" placeholder="新規患者名" value={newPatientName} onChange={(e) => setNewPatientName(e.target.value)} className="flex-1 border p-2 rounded text-sm" />
            <button type="submit" className="bg-blue-500 text-white px-3 rounded text-sm font-bold">＋</button>
          </form>
        </div>
        <div className="flex-1 overflow-y-auto">
          {patients.map(p => (
            <button 
              key={p.id} 
              onClick={() => { setSelectedPatient(p); setIsSidebarOpen(false); }} 
              className={`w-full text-left py-3 px-4 border-b border-gray-50 text-sm ${selectedPatient?.id === p.id ? 'bg-blue-100 border-l-4 border-blue-600 font-bold' : 'hover:bg-blue-50'}`}>
              {p.name}
            </button>
          ))}
        </div>
        <div className="p-4 border-t border-gray-200 bg-gray-50 shrink-0 hidden md:block">
          <button onClick={handleLogout} className="w-full text-sm bg-gray-200 text-gray-700 py-2 rounded hover:bg-gray-300 font-bold">ログアウト</button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-hidden bg-gray-100 w-full relative">
        
        <header className="md:hidden bg-blue-900 text-white p-3 flex justify-between items-center shrink-0 shadow-md z-30">
          <div className="flex items-center gap-3">
            <button onClick={() => setIsSidebarOpen(true)} className="p-1 focus:outline-none">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <span className="font-bold text-sm tracking-wider">
               {username} さん
            </span>
          </div>
          <button onClick={handleLogout} className="text-xs bg-blue-700 py-1 px-3 rounded hover:bg-blue-600 font-bold border border-blue-600">ログアウト</button>
        </header>

        {!selectedPatient ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-4 text-center">
            <svg className="w-16 h-16 mb-4 text-gray-300 md:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 6h16M4 12h16M4 18h16" /></svg>
            <p className="text-sm">左上の「三本線メニュー」から<br className="md:hidden"/>患者を選択してください</p>
          </div>
        ) : (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="bg-white border-b border-gray-200 px-4 md:px-8 pt-4 md:pt-6 shadow-sm shrink-0">
              
              <h2 className="text-xl md:text-2xl font-bold text-gray-800 mb-4 md:mb-6">{selectedPatient.name} さんの記録</h2>
              
              <div className="flex gap-1 overflow-x-auto">
                <button onClick={() => setActiveTab("history")} className={`px-5 py-3 font-bold text-sm rounded-t-lg whitespace-nowrap ${activeTab === "history" ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}> 過去の記録</button>
                <button onClick={() => setActiveTab("record")} className={`px-5 py-3 font-bold text-sm rounded-t-lg whitespace-nowrap ${activeTab === "record" ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600'}`}> 記録をつける</button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 md:p-8">
              {activeTab === "history" && (
                <div className="max-w-4xl mx-auto flex flex-col gap-4 md:gap-6 pb-10">
                  {records.length === 0 ? <p className="text-gray-500 text-center text-sm mt-10">記録がありません</p> : (
                    records.map(r => (
                      <div key={r.id}>
                        <div className="text-sm text-gray-500 mb-2 font-bold pl-2 border-l-4 border-blue-400"> {new Date(r.created_at).toLocaleString('ja-JP')}</div>
                        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 mb-2 shadow-sm"><SoapDisplay soapStr={r.soap_report} /></div>
                        <details className="text-xs text-gray-500 ml-2 mb-6"><summary className="cursor-pointer font-bold">文字起こしを表示</summary><p className="mt-2 p-3 bg-gray-50 border rounded">{r.transcription}</p></details>
                      </div>
                    ))
                  )}
                </div>
              )}
              {activeTab === "record" && (
                <div className="max-w-4xl mx-auto bg-white p-4 md:p-8 rounded-xl shadow-sm border border-gray-200 flex flex-col gap-4 md:gap-6 pb-10">
                  <div className="flex justify-center border-b pb-4 md:pb-6">
                    {!isRecording ? <button onClick={startRecording} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-8 md:px-10 rounded-full shadow text-sm md:text-base"> 録音して文字起こし</button> : <button onClick={stopRecording} className="bg-red-500 hover:bg-red-600 text-white font-bold py-4 px-8 md:px-10 rounded-full shadow animate-pulse text-sm md:text-base"> 録音を終了する</button>}
                  </div>
                  {isLoading && <p className="text-center text-blue-500 text-sm font-bold animate-pulse">AIが処理中...</p>}
                  <div><label className="block text-sm font-bold text-gray-700 mb-2"> 1. 文字起こし結果</label><textarea className="w-full h-32 border border-gray-300 p-3 rounded-lg text-sm" value={transcribedText} onChange={(e) => setTranscribedText(e.target.value)}></textarea></div>
                  <div><label className="block text-sm font-bold text-gray-700 mb-2"> 2. マスキング対象</label><input type="text" value={manualNames} onChange={(e) => setManualNames(e.target.value)} className="w-full border border-gray-300 p-3 rounded-lg text-sm"/></div>
                  <div className="bg-gray-50 p-4 rounded-lg border-2 border-dashed border-gray-300"><label className="block text-sm font-bold text-gray-700 mb-2"> 3. プレビュー</label><div className="text-gray-800 text-sm min-h-[3rem]" dangerouslySetInnerHTML={{ __html: highlightedText || "テキストを入力してください" }} /></div>
                  <button onClick={handleGenerateSoap} disabled={!maskedText || isLoading} className="mt-2 bg-green-500 text-white font-bold py-4 px-8 rounded-lg shadow disabled:opacity-50 text-sm md:text-base"> 安全な状態でSOAPを作成</button>
                  {finalSoap && (
                    <div className="mt-4 border-t pt-6 border-gray-200">
                      <h3 className="font-bold text-blue-900 mb-3 text-sm md:text-base"> 作成完了！</h3>
                      <div className="bg-blue-50 p-4 rounded-xl border border-blue-100"><SoapDisplay soapStr={finalSoap} /></div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}