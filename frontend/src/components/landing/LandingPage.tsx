import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldCheck, Brain, ArrowRight, Cpu,
  User as UserIcon, Lock as LockIcon, Eye, EyeOff, AlertCircle, X
} from 'lucide-react';
import { User } from '../../types';
import ExamXLogo from '../common/ExamXLogo';
import { dbService } from '../../services/dbService';

interface Props {
  onNavigate?: (view: string) => void;
  onLogin?: (user: User) => Promise<void> | void;
  initialShowSignIn?: boolean;
  darkMode: boolean;
  toggleTheme?: () => void;
}

const LandingPage: React.FC<Props> = ({ 
  onNavigate,
  onLogin, 
  initialShowSignIn = false, 
  darkMode 
}) => {
  const [isSignInOpen, setIsSignInOpen] = useState(initialShowSignIn);
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const userIdInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsSignInOpen(initialShowSignIn);
    setErrorMessage('');
    if (!initialShowSignIn) {
      setUserId('');
      setPassword('');
      setShowPassword(false);
    }
  }, [initialShowSignIn]);

  useEffect(() => {
    if (isSignInOpen) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      // Non-scrolling focus preserves viewport positioning and prevents page jump
      const timer = setTimeout(() => {
        userIdInputRef.current?.focus({ preventScroll: true });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isSignInOpen]);

  const handleOpenSignIn = () => {
    setErrorMessage('');
    setUserId('');
    setPassword('');
    setShowPassword(false);
    setIsSignInOpen(true);
    if (onNavigate) {
      onNavigate('LOGIN');
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleCloseSignIn = () => {
    setErrorMessage('');
    setUserId('');
    setPassword('');
    setShowPassword(false);
    setIsSignInOpen(false);
    if (onNavigate) {
      onNavigate('LANDING');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleUserIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUserId(e.target.value);
    if (errorMessage) {
      setErrorMessage('');
    }
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    if (errorMessage) {
      setErrorMessage('');
    }
  };

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedId = userId.trim();
    if (!trimmedId || !password) {
      setErrorMessage('Invalid User ID or password.');
      return;
    }

    setLoading(true);
    setErrorMessage('');

    try {
      const { user } = await dbService.login(trimmedId, password);
      const verifiedUser = (await dbService.getCurrentUser()) || user;

      if (onLogin) {
        await onLogin(verifiedUser);
      }
    } catch {
      setErrorMessage('Invalid User ID or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-slate-900 text-white' : 'bg-white text-slate-900'} overflow-x-hidden font-sans relative`}>
      {/* Background Gradients */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-blue-500/10 rounded-full blur-[120px] pointer-events-none animate-blob" />
      <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none animate-blob animation-delay-2000" />

      {/* Single Consistent Max-Width Content Container for Top Header and Hero */}
      <div className="w-full max-w-[1440px] mx-auto px-6 sm:px-10 min-h-screen flex flex-col relative z-10">
        {/* Top Header: ExamX Assessment Logo (Left) and Sign In (Right) */}
        <header className="w-full pt-6 sm:pt-8 pb-2 flex justify-between items-center bg-transparent border-0 shadow-none z-30 shrink-0">
          <div 
            className="flex items-center gap-3 cursor-pointer select-none group shrink-0" 
            onClick={handleCloseSignIn}
          >
            <ExamXLogo size={42} className="group-hover:scale-105 transition-transform duration-200 shadow-md shadow-blue-500/20 rounded-xl shrink-0" />
            <span className="text-[1.8rem] font-extrabold tracking-[-0.025em] text-slate-900 dark:text-white leading-tight select-none">
              Exam<span className="text-blue-600 dark:text-blue-500">X</span>
            </span>
          </div>

          <div className="shrink-0">
            {!isSignInOpen && (
              <button 
                onClick={handleOpenSignIn}
                className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-blue-600 dark:hover:bg-blue-100 px-7 py-3 rounded-full font-bold transition-all shadow-lg hover:shadow-blue-500/25 active:scale-95 text-[15px]"
              >
                Sign in
              </button>
            )}
          </div>
        </header>

        {/* Main Two-Column Hero Layout (Left: Existing Home Content; Right: Live Session Preview or Sign-In Panel) */}
        <main className="w-full flex-1 py-10 lg:py-14 flex items-center">
          <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            
            {/* LEFT SIDE: Existing ExamX Home Content */}
            <div className="lg:col-span-6 xl:col-span-7 animate-slide-up">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 dark:bg-slate-800 text-blue-600 dark:text-blue-400 font-bold text-sm mb-6 border border-blue-100 dark:border-slate-700">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                </span>
                Examination Platform
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-[1.1] sm:leading-[1.12] mb-6 tracking-[-0.03em]">
                <span className="font-extrabold text-slate-900 dark:text-white">Integrity in</span> <br/>
                <span className="text-gradient font-extrabold">Every Assessment.</span>
              </h1>

              <p className="text-base sm:text-lg font-medium text-slate-600 dark:text-slate-300 mb-8 leading-relaxed max-w-lg">
                Examination platform with automated evaluation, proctoring, and question management.
              </p>

              {!isSignInOpen && (
                <div className="flex flex-wrap gap-4">
                  <button 
                    onClick={handleOpenSignIn}
                    className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-8 py-4 rounded-full font-bold text-lg shadow-xl shadow-blue-500/30 hover:shadow-2xl hover:scale-105 transition-all flex items-center gap-2"
                  >
                    Sign in <ArrowRight size={20}/>
                  </button>
                </div>
              )}
            </div>

            {/* RIGHT SIDE: State 1 (Live Session Card) OR State 2 (Sign-In Panel) */}
            <div className="lg:col-span-6 xl:col-span-5 flex justify-center lg:justify-end">
              {isSignInOpen ? (
                /* STATE 2 — Right-Side Sign-In Panel with Top-Right Close X Control */
                <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-3xl p-7 sm:p-9 shadow-2xl border border-slate-200/90 dark:border-slate-700 animate-fade-in my-auto relative">
                  {/* Close X control at top-right of Sign-In panel */}
                  <button
                    type="button"
                    onClick={handleCloseSignIn}
                    className="absolute top-6 right-6 p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    aria-label="Close sign in"
                    title="Close sign in"
                  >
                    <X size={20} strokeWidth={2.2} />
                  </button>

                  <div className="mb-6 pr-8">
                    <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Sign in</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Enter your ID and password.
                    </p>
                  </div>

                  {errorMessage && (
                    <div className="mb-5 p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl flex items-center gap-2.5 text-xs font-semibold text-red-600 dark:text-red-400 animate-fade-in">
                      <AlertCircle size={16} className="shrink-0 text-red-500" />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  <form onSubmit={handleSignInSubmit} className="space-y-4">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                        USER ID
                      </label>
                      <div className="relative">
                        <UserIcon size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"/>
                        <input 
                          ref={userIdInputRef}
                          type="text" 
                          placeholder="Enter your User ID" 
                          value={userId} 
                          onChange={handleUserIdChange} 
                          className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl text-sm border border-slate-200 dark:border-slate-700 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-500/10 dark:focus:ring-blue-500/20 text-slate-900 dark:text-white placeholder:text-slate-400 transition-all font-medium" 
                          required 
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                        PASSWORD
                      </label>
                      <div className="relative">
                        <LockIcon size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"/>
                        <input 
                          type={showPassword ? "text" : "password"} 
                          placeholder="Enter your password" 
                          value={password} 
                          onChange={handlePasswordChange} 
                          className="w-full pl-10 pr-10 py-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl text-sm border border-slate-200 dark:border-slate-700 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-500/10 dark:focus:ring-blue-500/20 text-slate-900 dark:text-white placeholder:text-slate-400 transition-all font-medium" 
                          required 
                        />
                        <button 
                          type="button" 
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition"
                          title={showPassword ? "Hide password" : "Show password"}
                        >
                          {showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}
                        </button>
                      </div>
                    </div>

                    <button 
                      type="submit" 
                      disabled={loading} 
                      className="w-full bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white py-3.5 rounded-xl font-bold text-sm shadow-md shadow-blue-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                    >
                      {loading ? 'Signing in...' : 'Sign in'}
                    </button>
                  </form>
                </div>
              ) : (
                /* STATE 1 — Normal Home Interactive Card */
                <div className="relative animate-float w-full max-w-lg">
                  <div className="glass-card p-4 rounded-[2rem] relative z-10 transform rotate-[-1deg] hover:rotate-0 transition-all duration-500">
                    <div className="bg-slate-900 p-8 rounded-3xl text-white shadow-2xl border border-slate-700">
                      <div className="flex justify-between items-center mb-6 border-b border-slate-800 pb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full bg-red-500"></div>
                          <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                          <div className="w-3 h-3 rounded-full bg-green-500"></div>
                          <span className="text-xs font-mono text-slate-400 ml-2">PROCTOR_SESSION_LIVE</span>
                        </div>
                        <span className="bg-blue-600/30 text-blue-400 border border-blue-500/30 text-xs px-2.5 py-1 rounded-full font-mono font-semibold">Examination Active</span>
                      </div>

                      <div className="space-y-4">
                        <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700">
                          <div className="text-xs text-slate-400 uppercase font-bold mb-1 tracking-wider">Active Examination</div>
                          <div className="font-extrabold text-lg text-white tracking-tight">Examination Session</div>
                          <div className="flex justify-between text-xs text-slate-400 mt-2 font-mono">
                            <span>Duration: 45 Mins</span>
                            <span>Strict Mode: Active</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700">
                            <div className="text-xs font-semibold text-slate-400">Proctoring Status</div>
                            <div className="text-sm font-extrabold text-green-400 flex items-center gap-1.5 mt-1">
                              <ShieldCheck size={14} strokeWidth={2.5}/> Normal
                            </div>
                          </div>
                          <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700">
                            <div className="text-xs font-semibold text-slate-400">Automated Scoring</div>
                            <div className="text-sm font-extrabold text-blue-400 flex items-center gap-1.5 mt-1">
                              <Cpu size={14} strokeWidth={2.5}/> Verified
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Floating Badge 1 */}
                    <div className="absolute -top-6 right-0 sm:-right-2 bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-xl flex items-center gap-4 animate-bounce duration-[3000ms] border dark:border-slate-700">
                      <div className="bg-green-100 dark:bg-green-900/30 p-3 rounded-full text-green-600"><ShieldCheck size={24}/></div>
                      <div>
                        <div className="font-extrabold text-slate-900 dark:text-white tracking-tight">Anti-Cheat</div>
                        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Proctoring Guard</div>
                      </div>
                    </div>

                    {/* Floating Badge 2 */}
                    <div className="absolute -bottom-6 -left-4 bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-xl flex items-center gap-4 animate-bounce duration-[4000ms] border dark:border-slate-700">
                      <div className="bg-indigo-100 dark:bg-indigo-900/30 p-3 rounded-full text-indigo-600"><Brain size={24}/></div>
                      <div>
                        <div className="font-extrabold text-slate-900 dark:text-white tracking-tight">Question Pool</div>
                        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Curriculum MCQs</div>
                      </div>
                    </div>
                  </div>
                  {/* Decorative Elements */}
                  <div className="absolute -z-10 top-10 right-6 w-full h-full border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-[2.5rem] transform rotate-3"></div>
                </div>
              )}
            </div>

          </div>
        </main>
      </div>
    </div>
  );
};

export default LandingPage;
