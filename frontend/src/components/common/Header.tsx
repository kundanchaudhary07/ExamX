import React, { useState } from 'react';
import {
  LogOut,
  Sun,
  Moon,
  Bell,
  Menu,
  X,
  LayoutDashboard,
  Users,
  GraduationCap,
  FileText,
  BookOpen,
  Award,
  Shield,
  MessageSquare,
  ClipboardList,
  Settings,
  Sparkles,
  BarChart2,
  User as UserIcon,
  History,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';
import { User, UserRole } from '../../types';
import { ExamXLogo } from './ExamXLogo';

export interface NavItem {
  id: string;
  label: string;
  icon: React.FC<{ className?: string }>;
}

export const ADMIN_NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'teachers', label: 'Teachers', icon: Users },
  { id: 'students', label: 'Students', icon: GraduationCap },
  { id: 'exams', label: 'Exams', icon: FileText },
  { id: 'questions', label: 'Question Bank', icon: BookOpen },
  { id: 'results', label: 'Results', icon: Award },
  { id: 'proctoring', label: 'Proctoring', icon: Shield },
  { id: 'monitoring_history', label: 'Monitoring History', icon: History },
  { id: 'queries', label: 'Queries', icon: MessageSquare },
  { id: 'audit', label: 'Audit Logs', icon: ClipboardList },
  { id: 'settings', label: 'Settings', icon: Settings }
];

export const TEACHER_NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'students', label: 'Students', icon: GraduationCap },
  { id: 'exams', label: 'Exams', icon: FileText },
  { id: 'questions', label: 'Question Bank', icon: BookOpen },
  { id: 'ai_generator', label: 'AI Question Generation', icon: Sparkles },
  { id: 'monitoring', label: 'Exam Monitoring', icon: Shield },
  { id: 'monitoring_history', label: 'Monitoring History', icon: History },
  { id: 'results', label: 'Results', icon: Award },
  { id: 'queries', label: 'Queries', icon: MessageSquare },
  { id: 'profile', label: 'Profile', icon: UserIcon }
];

export const STUDENT_NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'exams', label: 'Exams', icon: FileText },
  { id: 'history', label: 'Exam History', icon: History },
  { id: 'results', label: 'Results', icon: Award },
  { id: 'analytics', label: 'Analytics', icon: BarChart2 },
  { id: 'queries', label: 'Queries', icon: MessageSquare },
  { id: 'proctoring', label: 'Proctoring Status', icon: Shield },
  { id: 'profile', label: 'Profile', icon: UserIcon }
];

export function getNavItemsForRole(role?: UserRole): NavItem[] {
  if (role === UserRole.ADMIN) return ADMIN_NAV_ITEMS;
  if (role === UserRole.TEACHER) return TEACHER_NAV_ITEMS;
  if (role === UserRole.STUDENT) return STUDENT_NAV_ITEMS;
  return [];
}

interface HeaderProps {
  user: User | null;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onLogout: () => void;
  onNavigateToDashboard?: () => void;
  activeTab?: string;
  onSelectTab?: (tabId: string) => void;
  notifications?: { id: string; title: string; timestamp: string }[];
  onClearNotifications?: () => void;
  hideSidebar?: boolean;
  sidebarCollapsed?: boolean;
  onToggleSidebarCollapse?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  darkMode,
  onToggleDarkMode,
  onLogout,
  onNavigateToDashboard,
  activeTab = 'overview',
  onSelectTab,
  notifications = [],
  onClearNotifications,
  hideSidebar = false,
  sidebarCollapsed = false,
  onToggleSidebarCollapse
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const navItems = getNavItemsForRole(user?.role);
  const activeNavItem = navItems.find(item => item.id === activeTab);
  const pageTitle = activeNavItem ? activeNavItem.label : 'Dashboard';

  const handleNavClick = (id: string) => {
    if (onSelectTab) {
      onSelectTab(id);
    } else if (onNavigateToDashboard) {
      onNavigateToDashboard();
    }
    setMobileMenuOpen(false);
  };

  return (
    <>
      {/* Desktop Collapsible Left Sidebar */}
      {user && !hideSidebar && (
        <aside
          aria-label="Sidebar Navigation"
          className={`hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 z-40 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 select-none transition-[width] duration-200 ease-in-out ${
            sidebarCollapsed ? 'lg:w-[72px]' : 'lg:w-[256px]'
          }`}
        >
          {/* Compact Brand Area + Collapse Toggle */}
          <div
            className={`h-16 flex items-center border-b border-slate-200 dark:border-slate-800 shrink-0 ${
              sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-4'
            }`}
          >
            <div
              onClick={() => handleNavClick('overview')}
              className="flex items-center gap-3 cursor-pointer min-w-0"
              title="ExamX Dashboard"
            >
              <ExamXLogo size={30} className="rounded-lg shrink-0" />
              {!sidebarCollapsed && (
                <span className="text-[19px] font-semibold tracking-tight text-slate-900 dark:text-white leading-none truncate">
                  Exam<span className="text-blue-600">X</span>
                </span>
              )}
            </div>

            {!sidebarCollapsed && onToggleSidebarCollapse && (
              <button
                type="button"
                onClick={onToggleSidebarCollapse}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="w-[18px] h-[18px]" />
              </button>
            )}
          </div>

          {sidebarCollapsed && onToggleSidebarCollapse && (
            <div className="px-2 pt-2.5 flex justify-center">
              <button
                type="button"
                onClick={onToggleSidebarCollapse}
                className="p-2.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="Expand sidebar"
                aria-label="Expand sidebar"
              >
                <PanelLeftOpen className="w-[18px] h-[18px]" />
              </button>
            </div>
          )}

          {/* Role Navigation Links */}
          <nav className="flex-1 overflow-y-auto px-3 py-3.5 space-y-1">
            {navItems.map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavClick(item.id)}
                  title={sidebarCollapsed ? item.label : undefined}
                  aria-label={item.label}
                  className={`group relative w-full h-11 flex items-center rounded-lg text-[14.5px] font-medium transition-colors ${
                    sidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-3.5 text-left'
                  } ${
                    isActive
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon
                    className={`w-[18px] h-[18px] shrink-0 ${
                      isActive
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300'
                    }`}
                  />
                  {!sidebarCollapsed ? (
                    <span className="truncate leading-snug">{item.label}</span>
                  ) : (
                    <span className="pointer-events-none fixed left-[78px] px-2.5 py-1.5 rounded-md bg-slate-900 text-white text-[13px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity shadow-md z-50">
                      {item.label}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Role Footer */}
          <div className="p-3 border-t border-slate-200 dark:border-slate-800">
            {sidebarCollapsed ? (
              <div
                className="h-10 rounded-lg bg-slate-50 dark:bg-slate-800/50 flex items-center justify-center text-[13px] font-semibold text-slate-600 dark:text-slate-300"
                title={`${user.role} · ${user.userId || user.id}`}
              >
                {user.role.charAt(0)}
              </div>
            ) : (
              <div className="px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between text-[13px]">
                <span className="text-slate-500 dark:text-slate-400 font-medium">{user.role}</span>
                <span className="font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                  {user.userId || user.id}
                </span>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Mobile / Tablet Slide-Over Sidebar Drawer */}
      {user && !hideSidebar && mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] bg-white dark:bg-slate-900 h-full flex flex-col border-r border-slate-200 dark:border-slate-800 z-10">
            <div className="h-16 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
              <div
                onClick={() => handleNavClick('overview')}
                className="flex items-center gap-3 cursor-pointer"
              >
                <ExamXLogo size={30} className="rounded-lg" />
                <span className="text-[19px] font-semibold tracking-tight text-slate-900 dark:text-white leading-none">
                  Exam<span className="text-blue-600">X</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close Menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
              {navItems.map(item => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavClick(item.id)}
                    className={`w-full h-11 flex items-center gap-3 px-3.5 rounded-lg text-[14.5px] font-medium transition-colors text-left ${
                      isActive
                        ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon
                      className={`w-[18px] h-[18px] shrink-0 ${
                        isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Top Header Bar */}
      <header
        className={`sticky top-0 z-30 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 transition-all duration-200 ease-in-out ${
          user && !hideSidebar ? (sidebarCollapsed ? 'lg:pl-[72px]' : 'lg:pl-[256px]') : ''
        }`}
      >
        <div className="h-16 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          {/* Left: Mobile Menu Button + Breadcrumb */}
          <div className="flex items-center gap-3 min-w-0">
            {user && !hideSidebar && (
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Open Navigation Menu"
              >
                <Menu className="w-5 h-5" />
              </button>
            )}

            {user && !hideSidebar && onToggleSidebarCollapse && (
              <button
                type="button"
                onClick={onToggleSidebarCollapse}
                className="hidden lg:inline-flex p-2 rounded-lg text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {sidebarCollapsed ? (
                  <PanelLeftOpen className="w-[18px] h-[18px]" />
                ) : (
                  <PanelLeftClose className="w-[18px] h-[18px]" />
                )}
              </button>
            )}

            {(!user || hideSidebar) && (
              <div
                onClick={() => handleNavClick('overview')}
                className="flex items-center gap-3 cursor-pointer shrink-0"
              >
                <ExamXLogo size={30} className="rounded-lg" />
                <span className="text-[19px] font-semibold tracking-tight text-slate-900 dark:text-white leading-none">
                  Exam<span className="text-blue-600">X</span>
                </span>
              </div>
            )}

            {user && !hideSidebar && (
              <div className="flex items-center gap-2 text-[14px] min-w-0">
                <span className="text-slate-400 dark:text-slate-500 hidden sm:inline">ExamX</span>
                <span className="text-slate-300 dark:text-slate-600 hidden sm:inline">/</span>
                <span className="font-semibold text-slate-900 dark:text-white truncate">
                  {pageTitle}
                </span>
              </div>
            )}
          </div>

          {/* Right: Theme Toggle, Notifications, User Identity, Role, Avatar, Logout */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={onToggleDarkMode}
              className="p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
              title="Toggle Theme"
              aria-label="Toggle Theme"
            >
              {darkMode ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
            </button>

            {user && (
              <>
                {/* Notifications */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setNotifOpen(prev => !prev)}
                    className="p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors relative"
                    title="Notifications"
                    aria-label="Notifications"
                  >
                    <Bell className="w-[18px] h-[18px]" />
                    {notifications.length > 0 && (
                      <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-600" />
                    )}
                  </button>

                  {notifOpen && (
                    <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-lg py-2 z-50">
                      <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                        <span className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">
                          Notifications ({notifications.length})
                        </span>
                        <div className="flex items-center gap-3">
                          {notifications.length > 0 && onClearNotifications && (
                            <button
                              type="button"
                              onClick={onClearNotifications}
                              className="text-[13px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              Clear
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setNotifOpen(false)}
                            className="text-[13px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                          >
                            Close
                          </button>
                        </div>
                      </div>
                      {notifications.length === 0 ? (
                        <div className="px-4 py-7 text-center text-[14px] text-slate-500 dark:text-slate-400">
                          No notifications.
                        </div>
                      ) : (
                        <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                          {notifications.map(n => (
                            <div key={n.id} className="px-4 py-3 text-[14px]">
                              <p className="text-slate-800 dark:text-slate-200 font-medium">{n.title}</p>
                              <p className="text-slate-500 text-[13px] mt-0.5">{n.timestamp}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />

                {/* Authenticated User Profile */}
                <button
                  type="button"
                  onClick={() => {
                    if (user.role === UserRole.ADMIN) {
                      handleNavClick('settings');
                    } else {
                      handleNavClick('profile');
                    }
                  }}
                  className="flex items-center gap-3 text-left rounded-lg px-2.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors"
                >
                  <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center text-[14px] font-semibold shrink-0">
                    {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                  </div>
                  <div className="hidden md:block">
                    <p className="text-[14px] font-medium text-slate-900 dark:text-white leading-tight">
                      {user.name}
                    </p>
                    <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-tight mt-0.5 tabular-nums">
                      {user.role} · {user.userId || user.id}
                    </p>
                  </div>
                </button>

                {/* Logout */}
                <button
                  type="button"
                  onClick={onLogout}
                  className="p-2.5 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors"
                  title="Logout"
                  aria-label="Logout"
                >
                  <LogOut className="w-[18px] h-[18px]" />
                </button>
              </>
            )}
          </div>
        </div>
      </header>
    </>
  );
};

export default Header;
