import React, { useState, useEffect, useCallback, Component, ErrorInfo, ReactNode } from 'react';
import { 
  Upload, 
  FileText, 
  Loader2, 
  Download, 
  Trash2, 
  Plus, 
  ChevronLeft, 
  LayoutDashboard, 
  Calendar,
  BarChart3,
  AlertCircle,
  CheckCircle2,
  LogIn,
  LogOut,
  User as UserIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  onAuthStateChanged, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  setDoc, 
  deleteDoc, 
  updateDoc, 
  doc,
  User
} from './firebase';

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<{ children: ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    const { hasError, error } = this.state;
    if (hasError) {
      let errorMessage = "发生了一些错误。";
      try {
        const parsed = JSON.parse(error?.message || "");
        if (parsed.error && parsed.error.includes("insufficient permissions")) {
          errorMessage = "权限不足，请确保您已登录。";
        }
      } catch (e) {
        errorMessage = error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl border border-red-100 max-w-md w-full text-center">
            <AlertCircle className="mx-auto text-red-500 mb-4" size={48} />
            <h2 className="text-xl font-bold mb-2 text-gray-800">出错了</h2>
            <p className="text-gray-600 mb-6">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-orange-500 text-white rounded-xl font-semibold hover:bg-orange-600 transition-all"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// --- Interfaces ---
interface AnalysisResult {
  word: string;
  pos: string;
  count: number;
}

interface FileData {
  name: string;
  data: string;
  mimeType: string;
}

interface Task {
  id: string;
  name: string;
  createdAt: number;
  results: AnalysisResult[];
  fileCount: number;
  uid: string;
}

function AppContent() {
  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // State for Task Management
  const [tasks, setTasks] = useState<Task[]>([]);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');

  // State for Current Task Analysis
  const [pendingFiles, setPendingFiles] = useState<FileData[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles) {
      processFiles(Array.from(droppedFiles) as File[]);
    }
  };

  const processFiles = (fileList: File[]) => {
    fileList.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = (event.target?.result as string).split(',')[1];
        let mimeType = file.type;
        
        // Fallback for missing mimeType based on extension
        if (!mimeType) {
          const ext = file.name.split('.').pop()?.toLowerCase();
          if (ext === 'pdf') mimeType = 'application/pdf';
          else if (['jpg', 'jpeg'].includes(ext || '')) mimeType = 'image/jpeg';
          else if (ext === 'png') mimeType = 'image/png';
          else mimeType = 'application/octet-stream';
        }

        setPendingFiles(prev => [...prev, {
          name: file.name,
          data: base64,
          mimeType: mimeType
        }]);
      };
      reader.readAsDataURL(file);
    });
  };

  // Handle Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Login failed:", err);
      setError("登录失败，请重试。");
    }
  };

  const handleLogout = async () => {
    try {
      await auth.signOut();
      setCurrentTaskId(null);
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  // Load tasks from Firestore
  useEffect(() => {
    if (!isAuthReady || !user) {
      setTasks([]);
      return;
    }

    const q = query(collection(db, 'tasks'), where('uid', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const taskList: Task[] = [];
      snapshot.forEach((doc) => {
        taskList.push(doc.data() as Task);
      });
      setTasks(taskList.sort((a, b) => b.createdAt - a.createdAt));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'tasks');
    });

    return () => unsubscribe();
  }, [user, isAuthReady]);

  const currentTask = tasks.find(t => t.id === currentTaskId);

  const createTask = async () => {
    if (!newTaskName.trim() || !user) return;
    const taskId = Date.now().toString();
    const newTask: Task = {
      id: taskId,
      name: newTaskName,
      createdAt: Date.now(),
      results: [],
      fileCount: 0,
      uid: user.uid
    };

    try {
      await setDoc(doc(db, 'tasks', taskId), newTask);
      setNewTaskName('');
      setIsCreatingTask(false);
      setCurrentTaskId(taskId);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `tasks/${taskId}`);
    }
  };

  const deleteTask = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('确定要删除这个任务及其所有数据吗？')) {
      try {
        await deleteDoc(doc(db, 'tasks', id));
        if (currentTaskId === id) setCurrentTaskId(null);
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `tasks/${id}`);
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles) return;
    processFiles(Array.from(uploadedFiles) as File[]);
  };

  const removePendingFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  const runAnalysis = async () => {
    if (pendingFiles.length === 0 || !currentTaskId || !currentTask) return;
    setIsAnalyzing(true);
    setAnalysisStatus('正在准备文件...');
    setError(null);
    setSuccessMessage(null);

    let allNewResults: AnalysisResult[] = [];
    let processedCount = 0;

    try {
      // Process files one by one to avoid large payloads and timeouts
      for (const file of pendingFiles) {
        processedCount++;
        setAnalysisStatus(`正在分析 (${processedCount}/${pendingFiles.length}): ${file.name}...`);
        
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: [file] })
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(`文件 "${file.name}" 分析失败: ${errData.error || '未知错误'}`);
        }
        
        const fileResults: AnalysisResult[] = await response.json();
        allNewResults = [...allNewResults, ...fileResults];
      }
      
      setAnalysisStatus('正在同步数据至云端...');
      
      // Cumulative Merge Logic
      const mergedResults = [...currentTask.results];
      allNewResults.forEach(newR => {
        const existingIdx = mergedResults.findIndex(r => r.word === newR.word);
        if (existingIdx > -1) {
          mergedResults[existingIdx].count += newR.count;
        } else {
          mergedResults.push(newR);
        }
      });

      const updatedTask = {
        ...currentTask,
        results: mergedResults.sort((a, b) => b.count - a.count),
        fileCount: currentTask.fileCount + pendingFiles.length
      };

      await updateDoc(doc(db, 'tasks', currentTaskId), {
        results: updatedTask.results,
        fileCount: updatedTask.fileCount
      });

      setPendingFiles([]);
      setSuccessMessage(`成功分析 ${pendingFiles.length} 份试卷，数据已累加。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发生未知错误');
    } finally {
      setIsAnalyzing(false);
      setAnalysisStatus(null);
    }
  };

  const exportToCSV = () => {
    if (!currentTask) return;
    const headers = ['Word', 'POS Tag', 'Total Frequency'];
    const rows = currentTask.results.map(r => [r.word, r.pos, r.count]);
    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${currentTask.name}_词频分析.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA]">
        <Loader2 className="animate-spin text-orange-500" size={48} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-10 rounded-3xl shadow-2xl border border-gray-100 max-w-md w-full text-center"
        >
          <div className="w-20 h-20 bg-orange-500 rounded-2xl flex items-center justify-center text-white mx-auto mb-6 shadow-lg shadow-orange-100">
            <LayoutDashboard size={40} />
          </div>
          <h1 className="text-2xl font-bold mb-2">高考英语分析中心</h1>
          <p className="text-gray-500 mb-8">请登录以管理您的分析任务并同步数据</p>
          <button 
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 py-4 bg-white border border-gray-200 rounded-2xl font-bold hover:bg-gray-50 transition-all shadow-sm group"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-6 h-6" />
            使用 Google 账号登录
          </button>
        </motion.div>
      </div>
    );
  }

  // Dashboard View
  if (!currentTaskId) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-orange-100">
        <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-orange-100">
                <LayoutDashboard size={24} />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">高考英语分析中心</h1>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Exam Analysis Dashboard</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg border border-gray-100">
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || ''} className="w-6 h-6 rounded-full" />
                ) : (
                  <UserIcon size={16} className="text-gray-400" />
                )}
                <span className="text-xs font-medium text-gray-600">{user.displayName}</span>
                <button onClick={handleLogout} className="p-1 hover:text-red-500 transition-colors" title="退出登录">
                  <LogOut size={14} />
                </button>
              </div>
              <button 
                onClick={() => setIsCreatingTask(true)}
                className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-semibold hover:bg-orange-600 transition-all shadow-md shadow-orange-100"
              >
                <Plus size={18} />
                新建分析任务
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-6 py-10">
          {isCreatingTask && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-10 bg-white p-6 rounded-2xl border border-orange-200 shadow-xl shadow-orange-50"
            >
              <h2 className="text-lg font-bold mb-4">创建新任务</h2>
              <div className="flex gap-3">
                <input 
                  type="text" 
                  placeholder="例如：2023年全国卷分析、模拟考类型一..."
                  className="flex-1 px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                  value={newTaskName}
                  onChange={(e) => setNewTaskName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createTask()}
                  autoFocus
                />
                <button 
                  onClick={createTask}
                  className="px-6 py-2 bg-orange-500 text-white rounded-xl font-semibold hover:bg-orange-600 transition-all"
                >
                  创建
                </button>
                <button 
                  onClick={() => setIsCreatingTask(false)}
                  className="px-6 py-2 bg-gray-100 text-gray-600 rounded-xl font-semibold hover:bg-gray-200 transition-all"
                >
                  取消
                </button>
              </div>
            </motion.div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {tasks.map((task) => (
              <motion.div 
                key={task.id}
                whileHover={{ y: -4 }}
                onClick={() => setCurrentTaskId(task.id)}
                className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all cursor-pointer group relative"
              >
                <button 
                  onClick={(e) => deleteTask(task.id, e)}
                  className="absolute top-4 right-4 p-2 text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={16} />
                </button>
                <div className="w-12 h-12 bg-orange-50 rounded-xl flex items-center justify-center text-orange-500 mb-4">
                  <BarChart3 size={24} />
                </div>
                <h3 className="text-lg font-bold text-gray-800 mb-2 truncate pr-8">{task.name}</h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Calendar size={14} />
                    {new Date(task.createdAt).toLocaleDateString()}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <FileText size={14} />
                    已累计 {task.fileCount} 份试卷
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <CheckCircle2 size={14} className="text-green-500" />
                    核心词汇 {task.results.length} 个
                  </div>
                </div>
              </motion.div>
            ))}
            {tasks.length === 0 && !isCreatingTask && (
              <div className="col-span-full py-20 flex flex-col items-center justify-center text-gray-300">
                <LayoutDashboard size={64} strokeWidth={1} className="mb-4" />
                <p className="text-lg font-medium">还没有分析任务，点击右上角创建一个吧</p>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  // Task Detail View
  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-orange-100">
      <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => {
                setCurrentTaskId(null);
                setPendingFiles([]);
                setError(null);
                setSuccessMessage(null);
              }}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500"
            >
              <ChevronLeft size={24} />
            </button>
            <div>
              <h1 className="text-xl font-bold tracking-tight">{currentTask?.name}</h1>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">
                已累计 {currentTask?.fileCount} 份试卷 · 云端同步
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {currentTask && currentTask.results.length > 0 && (
              <button 
                onClick={exportToCSV}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm"
              >
                <Download size={16} />
                导出数据
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-10">
        {/* Left Column: Upload & Controls */}
        <div className="lg:col-span-4 space-y-6">
          <section className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-4">新增试卷</h2>
            
            <label 
              className="relative group cursor-pointer block"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 transition-all ${
                isDragging 
                  ? 'border-orange-500 bg-orange-50' 
                  : 'border-gray-200 group-hover:border-orange-300 group-hover:bg-orange-50/30'
              }`}>
                <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                  isDragging ? 'bg-orange-200' : 'bg-gray-50 group-hover:bg-orange-100'
                }`}>
                  <Plus className={`transition-colors ${isDragging ? 'text-orange-600' : 'text-gray-400 group-hover:text-orange-500'}`} />
                </div>
                <span className="text-sm font-medium text-gray-600">
                  {isDragging ? '松开以上传' : '点击或拖拽上传新试卷'}
                </span>
              </div>
              <input 
                type="file" 
                multiple 
                accept="application/pdf,image/*" 
                className="hidden" 
                onChange={handleFileUpload}
              />
            </label>

            <div className="mt-6 space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
              <AnimatePresence>
                {pendingFiles.map((file, idx) => (
                  <motion.div 
                    key={idx}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100 group"
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <FileText size={16} className="text-orange-500 shrink-0" />
                      <span className="text-sm truncate font-medium text-gray-700">{file.name}</span>
                    </div>
                    <button 
                      onClick={() => removePendingFile(idx)}
                      className="text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={16} />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <button 
              disabled={pendingFiles.length === 0 || isAnalyzing}
              onClick={runAnalysis}
              className="w-full mt-6 py-3 bg-orange-500 text-white rounded-xl font-semibold shadow-lg shadow-orange-200 hover:bg-orange-600 disabled:bg-gray-200 disabled:shadow-none transition-all flex items-center justify-center gap-2"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  {analysisStatus}
                </>
              ) : (
                '开始分析并累加数据'
              )}
            </button>

            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl text-xs flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            {successMessage && (
              <div className="mt-4 p-3 bg-green-50 border border-green-100 text-green-600 rounded-xl text-xs flex items-start gap-2">
                <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                {successMessage}
              </div>
            )}
          </section>

          <section className="bg-orange-50 rounded-2xl p-6 border border-orange-100">
            <h3 className="text-orange-800 font-bold text-sm mb-2">云端累积系统</h3>
            <p className="text-xs text-orange-700 leading-relaxed">
              当前任务的数据已自动同步到云端。您可以随时切换设备，数据始终保持同步。
              上传新试卷后，系统会自动识别重复单词并增加其频次。
            </p>
          </section>
        </div>

        {/* Right Column: Results */}
        <div className="lg:col-span-8">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden min-h-[600px]">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">
                累积词汇表 ({currentTask?.results.length})
              </h2>
              <span className="text-[10px] font-mono text-gray-400 bg-white px-2 py-1 rounded border border-gray-100">
                CLOUD SYNCED
              </span>
            </div>

            {currentTask && currentTask.results.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">单词原貌 (Word)</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">词性 (POS)</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">总频次 (Total)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentTask.results.map((item, idx) => (
                      <tr 
                        key={idx} 
                        className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors group"
                      >
                        <td className="px-6 py-4 font-mono text-sm font-semibold text-gray-800">{item.word}</td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-[10px] font-bold uppercase tracking-tighter">
                            {item.pos}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-sm font-bold text-orange-600 bg-orange-50 px-3 py-1 rounded-full">
                            {item.count}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-[500px] text-gray-300">
                <BarChart3 size={64} strokeWidth={1} className="mb-4" />
                <p className="text-sm">暂无累积数据，请上传试卷开始分析</p>
              </div>
            )}
          </div>
        </div>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #E5E7EB;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #D1D5DB;
        }
      `}</style>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
