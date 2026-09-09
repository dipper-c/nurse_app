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
  const [draggedPatientId, setDraggedPatientId] = useState<number | null>(null);

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
  const API_BASE = "http://127.0.0.1:8000";

 
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");

    if ((authMode === "register" || authMode === "forgot") && password !== confirmPassword) {
      setAuthError("パスワードと確認用パスワードが一致しません");
      return;
    }

    try {
      const formData = new URLSearchParams();
      formData.append("username", username);
      
      let endpoint = "/login";
      if (authMode === "register") {
        endpoint = "/register";
        formData.append("password", password);
        formData.append("secret_word", secretWord);
      } else if (authMode === "forgot") {
        endpoint = "/reset_password";
        formData.append("secret_word", secretWord);
        formData.append("new_password", password);
      } else {
        formData.append("password", password);
      }
      
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formData.toString()
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "エラーが発生しました");
      
      if (authMode === "login") {
        setToken(data.access_token);
      } else {
        alert(authMode === "register" ? "登録完了！ログインしてください。" : "パスワードをリセットしました！ログインしてください。");
        setAuthMode("login"); setPassword(""); setConfirmPassword(""); setSecretWord("");
      }
    } catch (error: any) { setAuthError(error.message); }
  };

  const handleLogout = () => {
    setToken(null); setUsername(""); setPassword(""); setConfirmPassword(""); setSecretWord(""); setPatients([]);
    setSelectedPatient(null); setRecords([]); setActiveTab("history");
    setTranscribedText(""); setManualNames(""); setHighlightedText(""); setMaskedText(""); setMaskingDict({}); setFinalSoap("");
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm("⚠️ 本当にアカウントを削除しますか？\n登録した患者データ、レポート履歴すべてが完全に消去され、元に戻せません。")) return;
    try {
      const res = await fetch(`${API_BASE}/users/me`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) { alert("アカウントを削除しました。"); handleLogout(); }
    } catch (e) { alert("削除に失敗しました"); }
  };

  const fetchPatients = async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/patients`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setPatients(await res.json());
  };

  const handleAddPatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPatientName.trim()) return;
    const res = await fetch(`${API_BASE}/patients`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: newPatientName }),
    });
    if (res.ok) { setNewPatientName(""); fetchPatients(); }
  };

  const fetchRecords = async (patientId: number) => {
    const res = await fetch(`${API_BASE}/patients/${patientId}/records`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setRecords(await res.json());
  };

  const handleDragStart = (id: number) => setDraggedPatientId(id);
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = async (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (!draggedPatientId || draggedPatientId === targetId) return;
    const newPatients = [...patients];
    const draggedIndex = newPatients.findIndex(p => p.id === draggedPatientId);
    const targetIndex = newPatients.findIndex(p => p.id === targetId);
    const [draggedItem] = newPatients.splice(draggedIndex, 1);
    newPatients.splice(targetIndex, 0, draggedItem);
    setPatients(newPatients);
    await fetch(`${API_BASE}/patients/reorder`, {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ patient_ids: newPatients.map(p => p.id) }),
    });
    setDraggedPatientId(null);
  };

  useEffect(() => { if (token) fetchPatients(); }, [token]);
  useEffect(() => {
    if (selectedPatient) { fetchRecords(selectedPatient.id); setActiveTab("history"); setManualNames(selectedPatient.name); setTranscribedText(""); setFinalSoap(""); }
  }, [selectedPatient]);

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
    const res = await fetch(`${API_BASE}/analyze_masking`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: transcribedText, manual_names: manualNames }),
    });
    const data = await res.json();
    setHighlightedText(data.highlighted_text); setMaskedText(data.masked_text); setMaskingDict(data.masking_dict);
  };
  useEffect(() => { const timer = setTimeout(() => { analyzeText(); }, 500); return () => clearTimeout(timer); }, [transcribedText, manualNames]);

  const handleGenerateSoap = async () => {
    if (!selectedPatient) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/generate_soap`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ patient_id: selectedPatient.id, masked_text: maskedText, masking_dict: maskingDict, original_text: transcribedText }),
      });
      const data = await res.json(); setFinalSoap(data.final_soap); fetchRecords(selectedPatient.id);
    } catch (error) { alert("SOAP生成失敗"); } finally { setIsLoading(false); }
  };

  const SoapDisplay = ({ soapStr }: { soapStr: string }) => {
    let soapData: any = {};
    try { soapData = JSON.parse(soapStr); } catch (e) { soapData = { "テキスト": soapStr }; }
    
    return (
      <div className="flex flex-col gap-3">
        {Object.entries(soapData).map(([key, value]) => (
          <div key={key} className="bg-white border border-blue-200 rounded-lg p-4 shadow-sm relative group">
            <div className="flex justify-between items-center mb-2">
              <span className="font-bold text-blue-900 text-lg">{key}</span>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(String(value));
                  alert(`${key} をコピーしました！`);
                }}
                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 py-1 px-3 rounded shadow-sm border border-gray-300 transition"
              >
                 コピー
              </button>
            </div>
            <p className="text-gray-800 whitespace-pre-wrap">{String(value)}</p>
          </div>
        ))}
      </div>
    );
  };

 
  if (!token) {
    return (
      <div className="min-h-screen bg-blue-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-lg w-full max-w-md">
          <h1 className="text-2xl font-bold text-center text-blue-900 mb-6">
            {authMode === "login" ? "ログイン" : authMode === "register" ? "新規登録" : "パスワードリセット"}
          </h1>
          {authError && <div className="bg-red-100 text-red-600 p-3 rounded mb-4 text-sm font-bold">{authError}</div>}
          <form onSubmit={handleAuth} className="flex flex-col gap-4">
            <input type="text" placeholder="ID (半角英数字4文字以上)" value={username} onChange={(e) => setUsername(e.target.value)} className="border p-3 rounded" required />
            
            {(authMode === "register" || authMode === "forgot") && (
              <input type="text" placeholder={authMode === "register" ? "秘密の言葉（忘れた時用）" : "登録した秘密の言葉を入力"} value={secretWord} onChange={(e) => setSecretWord(e.target.value)} className="border p-3 rounded bg-yellow-50" required />
            )}
            
            <input type="password" placeholder={authMode === "forgot" ? "新しいパスワード (英数混在8文字以上)" : "パスワード (英数混在8文字以上)"} value={password} onChange={(e) => setPassword(e.target.value)} className="border p-3 rounded" required />
            
            {(authMode === "register" || authMode === "forgot") && (
              <input type="password" placeholder="パスワード（確認用）" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="border p-3 rounded bg-gray-50" required />
            )}

            <button type="submit" className="bg-blue-600 text-white font-bold py-3 rounded hover:bg-blue-700">
              {authMode === "login" ? "ログイン" : authMode === "register" ? "登録する" : "パスワードを変更"}
            </button>
          </form>
          
          <div className="mt-6 flex flex-col gap-2 text-sm text-center">
            {authMode !== "login" && (
              <button onClick={() => { setAuthMode("login"); setAuthError(""); setConfirmPassword(""); }} className="text-blue-500">ログイン画面に戻る</button>
            )}
            {authMode === "login" && (
              <>
                <button onClick={() => { setAuthMode("register"); setAuthError(""); setConfirmPassword(""); }} className="text-blue-500">新規登録はこちら</button>
                <button onClick={() => { setAuthMode("forgot"); setAuthError(""); setConfirmPassword(""); }} className="text-gray-500 text-xs mt-2">パスワードを忘れた場合</button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className="flex h-screen bg-gray-100">
      <aside className="w-72 bg-white border-r border-gray-200 flex flex-col h-full shadow-sm z-10">
        <div className="p-4 bg-blue-900 text-white flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <h1 className="font-bold tracking-wider">看護レポート</h1>
            <button onClick={handleLogout} className="text-xs bg-blue-700 py-1 px-3 rounded hover:bg-blue-600 font-bold">ログアウト</button>
          </div>
          <div className="text-xs text-blue-200 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-green-400"></span>  {username}
          </div>
        </div>
        
        <div className="p-4 border-b border-gray-100 bg-gray-50">
          <form onSubmit={handleAddPatient} className="flex gap-2">
            <input type="text" placeholder="新規患者名" value={newPatientName} onChange={(e) => setNewPatientName(e.target.value)} className="flex-1 border p-2 rounded text-sm focus:outline-none focus:border-blue-500" />
            <button type="submit" className="bg-blue-500 text-white px-3 rounded text-sm font-bold hover:bg-blue-600">＋</button>
          </form>
        </div>

        <div className="flex-1 overflow-y-auto pt-2">
          {patients.map(p => (
            <div key={p.id} draggable onDragStart={() => handleDragStart(p.id)} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, p.id)}
              className={`group flex items-center border-b border-gray-50 transition cursor-grab active:cursor-grabbing hover:bg-blue-50 ${selectedPatient?.id === p.id ? 'bg-blue-100 border-l-4 border-blue-600 font-bold' : ''}`}>
              <div className="text-gray-300 px-3 opacity-50 group-hover:opacity-100 group-hover:text-gray-500">☰</div>
              <button onClick={() => setSelectedPatient(p)} className="flex-1 text-left py-4 pr-4 focus:outline-none">{p.name}</button>
            </div>
          ))}
        </div>
        
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <button onClick={handleDeleteAccount} className="w-full text-xs text-red-500 hover:text-red-700 hover:underline text-left py-2"> アカウントを削除する</button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-full overflow-hidden bg-gray-100">
        {!selectedPatient ? (
          <div className="flex-1 flex items-center justify-center text-gray-400"> 左側のリストから患者を選択するか、新しく追加してください</div>
        ) : (
          <div className="flex flex-col h-full">
            <div className="bg-white border-b border-gray-200 px-8 pt-6 shadow-sm">
              <h2 className="text-2xl font-bold text-gray-800 mb-6">{selectedPatient.name} さんのカルテ</h2>
              <div className="flex gap-1">
                <button onClick={() => setActiveTab("history")} className={`px-6 py-3 font-bold text-sm rounded-t-lg transition ${activeTab === "history" ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}> 過去の記録</button>
                <button onClick={() => setActiveTab("record")} className={`px-6 py-3 font-bold text-sm rounded-t-lg transition ${activeTab === "record" ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}> 今日の記録をつける</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-8">
              {activeTab === "history" && (
                <div className="max-w-4xl mx-auto flex flex-col gap-6">
                  {records.length === 0 ? <p className="text-gray-500 text-center mt-10">記録がありません</p> : (
                    records.map(r => (
                      <div key={r.id}>
                        <div className="text-sm text-gray-500 mb-2 font-bold pl-2 border-l-4 border-blue-400">
                           {new Date(r.created_at).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 mb-2 shadow-sm">
                          <SoapDisplay soapStr={r.soap_report} />
                        </div>
                        <details className="text-xs text-gray-500 ml-2 mb-8"><summary className="cursor-pointer font-bold">元の文字起こしを表示</summary><p className="mt-2 p-3 bg-gray-50 border rounded">{r.transcription}</p></details>
                      </div>
                    ))
                  )}
                </div>
              )}
              {activeTab === "record" && (
                <div className="max-w-4xl mx-auto bg-white p-8 rounded-xl shadow-sm border border-gray-200 flex flex-col gap-6">
                  <div className="flex justify-center border-b pb-6">
                    {!isRecording ? <button onClick={startRecording} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-10 rounded-full shadow transition transform hover:scale-105"> 録音して文字起こし</button> : <button onClick={stopRecording} className="bg-red-500 hover:bg-red-600 text-white font-bold py-4 px-10 rounded-full shadow animate-pulse"> 録音を終了する</button>}
                  </div>
                  {isLoading && <p className="text-center text-blue-500 font-bold animate-pulse">AIが処理中...</p>}
                  <div><label className="block text-sm font-bold text-gray-700 mb-2"> 1. 文字起こし結果</label><textarea className="w-full h-32 border border-gray-300 p-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400" value={transcribedText} onChange={(e) => setTranscribedText(e.target.value)}></textarea></div>
                  <div><label className="block text-sm font-bold text-gray-700 mb-2"> 2. マスキング対象</label><input type="text" value={manualNames} onChange={(e) => setManualNames(e.target.value)} className="w-full border border-gray-300 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"/></div>
                  <div className="bg-gray-50 p-4 rounded-lg border-2 border-dashed border-gray-300"><label className="block text-sm font-bold text-gray-700 mb-2"> 3. プレビュー</label><div className="text-gray-800 min-h-[3rem]" dangerouslySetInnerHTML={{ __html: highlightedText || "テキストを入力してください" }} /></div>
                  <button onClick={handleGenerateSoap} disabled={!maskedText || isLoading} className="mt-2 bg-green-500 hover:bg-green-600 text-white font-bold py-4 px-8 rounded-lg shadow disabled:opacity-50 transition transform hover:scale-105"> 安全な状態でSOAPを作成</button>
                  {finalSoap && (
                    <div className="mt-4 border-t pt-6 border-gray-200">
                      <h3 className="font-bold text-blue-900 mb-3"> 作成完了！（各項目をコピーできます）</h3>
                      <div className="bg-blue-50 p-6 rounded-xl border border-blue-100">
                        <SoapDisplay soapStr={finalSoap} />
                      </div>
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