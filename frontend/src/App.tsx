import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { QueueWidget } from './components/QueueWidget'
import { QueueNotifications } from './components/QueueNotifications'
import { DragDropProvider } from './components/DragDropProvider'
import { Dashboard } from './pages/Dashboard'
import { Search } from './pages/Search'
import { Downloads } from './pages/Downloads'
import { Settings } from './pages/Settings'
import Library from './pages/Library'
import HotBooks from './pages/HotBooks'

import { ToastProvider } from './components/ui/ToastProvider'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (failureCount, error: any) => {
        // Don't retry on 4xx errors
        if (error?.status >= 400 && error?.status < 500) return false
        return failureCount < 2
      },
      staleTime: 5 * 60 * 1000, // 5 minutes fresh
      gcTime: 30 * 60 * 1000,   // 30 minutes in cache
      refetchOnReconnect: true,
      refetchIntervalInBackground: false,
    },
    mutations: {
      retry: 1,
    },
  },
})

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true) // Start open on desktop
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system')

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router>
          <ProtectedRoute>
            <DragDropProvider>
              <ToastProvider>
                <div className={`min-h-screen h-screen bg-background overflow-hidden ${theme === 'dark' ? 'dark' : ''}`}>
                <div className="flex h-full">
                  {/* Fixed Sidebar */}
                  <div className="flex-shrink-0">
                    <Sidebar open={sidebarOpen} onOpenChange={setSidebarOpen} />
                  </div>
                  
                  {/* Main Content */}
                  <div className="flex-1 flex flex-col min-w-0 h-full">
                    {/* Fixed Header */}
                    <div className="flex-shrink-0">
                      <Header 
                        onMenuClick={() => setSidebarOpen(!sidebarOpen)}
                        theme={theme}
                        onThemeChange={setTheme}
                      />
                    </div>
                    
                    {/* Scrollable Main Content Area */}
                    <main className="flex-1 overflow-auto">
                      <div className="container mx-auto px-6 py-8">
                                        <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/search" element={<Search />} />
                  <Route path="/library" element={<Library />} />
                  <Route path="/hot" element={<HotBooks />} />
                  <Route path="/downloads" element={<Downloads />} />
                  <Route path="/settings" element={<Settings />} />
                </Routes>
                      </div>
                    </main>
                  </div>
                </div>
              </div>
              
                {/* Queue Widget - Fixed Position */}
                <QueueWidget />
                
                {/* Queue Notifications - Fixed Position */}
                <QueueNotifications />
              </ToastProvider>
            </DragDropProvider>
          </ProtectedRoute>
        </Router>
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App