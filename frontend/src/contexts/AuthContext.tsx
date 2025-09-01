import React, { createContext, useContext, useState, useEffect } from 'react'

interface AuthContextType {
  isAuthenticated: boolean
  credentials: string | null
  login: (username: string, password: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [credentials, setCredentials] = useState<string | null>(null)

  useEffect(() => {
    // Check if we have stored credentials
    const storedCredentials = localStorage.getItem('authCredentials')
    if (storedCredentials) {
      setCredentials(storedCredentials)
      setIsAuthenticated(true)
    }
  }, [])

  const login = (username: string, password: string) => {
    const encodedCredentials = btoa(`${username}:${password}`)
    setCredentials(encodedCredentials)
    setIsAuthenticated(true)
    localStorage.setItem('authCredentials', encodedCredentials)
  }

  const logout = () => {
    setCredentials(null)
    setIsAuthenticated(false)
    localStorage.removeItem('authCredentials')
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, credentials, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
