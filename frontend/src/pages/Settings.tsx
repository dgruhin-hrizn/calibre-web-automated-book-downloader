import { useState, useEffect } from 'react'
import { Button } from '../components/ui/Button'
import { Eye, EyeOff, ExternalLink, Check, X, AlertCircle, Loader2, Server, Wifi } from 'lucide-react'
import { useCWASettingsManager, type CWASettings } from '../hooks/useCWASettings'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx'

interface GoogleBooksSettings {
  apiKey: string
  isValid: boolean
  lastChecked?: string
}

export function Settings() {
  const [googleBooksKey, setGoogleBooksKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [isTestingKey, setIsTestingKey] = useState(false)
  const [keyStatus, setKeyStatus] = useState<'unchecked' | 'valid' | 'invalid'>('unchecked')
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  
  // CWA Settings
  const cwaManager = useCWASettingsManager()
  const [cwaSettings, setCwaSettings] = useState<CWASettings>(cwaManager.settings)
  const [showCwaPassword, setShowCwaPassword] = useState(false)

  // Load current API key on mount
  useEffect(() => {
    loadGoogleBooksSettings()
  }, [])
  
  // Update CWA settings when loaded
  useEffect(() => {
    setCwaSettings(cwaManager.settings)
  }, [cwaManager.settings])

  const loadGoogleBooksSettings = async () => {
    try {
      const response = await fetch('http://localhost:8084/api/settings/google-books', {
        credentials: 'include'
      })
      if (response.ok) {
        const settings: GoogleBooksSettings = await response.json()
        setGoogleBooksKey(settings.apiKey || '')
        setKeyStatus(settings.isValid ? 'valid' : settings.apiKey ? 'invalid' : 'unchecked')
      }
    } catch (error) {
      console.error('Failed to load Google Books settings:', error)
    }
  }

  const testApiKey = async (key: string) => {
    if (!key.trim()) {
      setKeyStatus('unchecked')
      return false
    }

    setIsTestingKey(true)
    try {
      const response = await fetch('http://localhost:8084/api/settings/google-books/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ apiKey: key })
      })
      
      if (response.ok) {
        const result = await response.json()
        const isValid = result.valid
        setKeyStatus(isValid ? 'valid' : 'invalid')
        return isValid
      } else {
        console.error('Failed to test API key:', response.status, response.statusText)
        setKeyStatus('invalid')
        return false
      }
    } catch (error) {
      console.error('Failed to test API key:', error)
      setKeyStatus('invalid')
      return false
    } finally {
      setIsTestingKey(false)
    }
  }

  const saveGoogleBooksSettings = async () => {
    setIsSaving(true)
    setSaveMessage('')
    
    try {
      // Test the key first if it's provided
      let isValid = false
      if (googleBooksKey.trim()) {
        isValid = await testApiKey(googleBooksKey)
      }

      const response = await fetch('http://localhost:8084/api/settings/google-books', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ 
          apiKey: googleBooksKey,
          isValid 
        })
      })

      if (response.ok) {
        setSaveMessage('Google Books API settings saved successfully!')
        setTimeout(() => setSaveMessage(''), 3000)
      } else {
        setSaveMessage('Failed to save settings')
      }
    } catch (error) {
      console.error('Failed to save Google Books settings:', error)
      setSaveMessage('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }
  
  // CWA Settings Functions
  const handleCwaSettingChange = (key: keyof CWASettings, value: any) => {
    setCwaSettings(prev => ({ ...prev, [key]: value }))
  }
  
  const saveCwaSettings = () => {
    cwaManager.saveSettings(cwaSettings)
  }
  
  const testCwaConnection = () => {
    cwaManager.testConnection(cwaSettings)
  }
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Configure your book downloader preferences
        </p>
      </div>

      <div className="grid gap-6">
        {/* CWA Integration Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="w-5 h-5" />
              Calibre-Web-Automated Integration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Connect to an existing Calibre-Web-Automated instance to browse and read your library books.
            </p>
            
            {/* Enable/Disable Toggle */}
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="cwa-enabled"
                checked={cwaSettings.enabled}
                onChange={(e) => handleCwaSettingChange('enabled', e.target.checked)}
                className="rounded"
              />
              <label htmlFor="cwa-enabled" className="text-sm font-medium">
                Enable CWA Integration
              </label>
            </div>
            
            {cwaSettings.enabled && (
              <div className="space-y-4 pl-6 border-l-2 border-muted">
                {/* Base URL */}
                <div>
                  <label className="block text-sm font-medium mb-2">
                    CWA Base URL
                  </label>
                  <input
                    type="text"
                    value={cwaSettings.base_url}
                    onChange={(e) => handleCwaSettingChange('base_url', e.target.value)}
                    placeholder="http://localhost:8083"
                    className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    The URL where your CWA instance is running
                  </p>
                </div>
                
                {/* Username */}
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Username (Optional)
                  </label>
                  <input
                    type="text"
                    value={cwaSettings.username}
                    onChange={(e) => handleCwaSettingChange('username', e.target.value)}
                    placeholder="Leave empty for anonymous access"
                    className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                
                {/* Password */}
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Password (Optional)
                  </label>
                  <div className="relative">
                    <input
                      type={showCwaPassword ? "text" : "password"}
                      value={cwaSettings.password}
                      onChange={(e) => handleCwaSettingChange('password', e.target.value)}
                      placeholder="Leave empty for anonymous access"
                      className="w-full px-3 py-2 pr-10 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCwaPassword(!showCwaPassword)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                    >
                      {showCwaPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                
                {/* Advanced Settings */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Timeout (seconds)
                    </label>
                    <input
                      type="number"
                      min="5"
                      max="300"
                      value={cwaSettings.timeout}
                      onChange={(e) => handleCwaSettingChange('timeout', parseInt(e.target.value) || 30)}
                      className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  
                  <div className="flex items-center space-x-3 mt-6">
                    <input
                      type="checkbox"
                      id="cwa-verify-ssl"
                      checked={cwaSettings.verify_ssl}
                      onChange={(e) => handleCwaSettingChange('verify_ssl', e.target.checked)}
                      className="rounded"
                    />
                    <label htmlFor="cwa-verify-ssl" className="text-sm">
                      Verify SSL certificates
                    </label>
                  </div>
                </div>
                
                {/* Connection Test */}
                <div className="space-y-3">
                  <div className="flex space-x-3">
                    <Button 
                      variant="outline" 
                      onClick={testCwaConnection}
                      disabled={cwaManager.testingConnection}
                      className="flex items-center gap-2"
                    >
                      {cwaManager.testingConnection ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Testing...
                        </>
                      ) : (
                        <>
                          <Wifi className="w-4 h-4" />
                          Test Connection
                        </>
                      )}
                    </Button>
                    
                    <Button 
                      onClick={saveCwaSettings}
                      disabled={cwaManager.savingSettings}
                      className="flex items-center gap-2"
                    >
                      {cwaManager.savingSettings ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        'Save CWA Settings'
                      )}
                    </Button>
                  </div>
                  
                  {/* Test Result */}
                  {cwaManager.testResult && (
                    <div className={`text-sm p-3 rounded-md flex items-center gap-2 ${
                      cwaManager.testResult.success 
                        ? 'bg-green-50 text-green-700 border border-green-200' 
                        : 'bg-red-50 text-red-700 border border-red-200'
                    }`}>
                      {cwaManager.testResult.success ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <X className="w-4 h-4" />
                      )}
                      <div>
                        <div className="font-medium">
                          {cwaManager.testResult.success ? 'Connection Successful' : 'Connection Failed'}
                        </div>
                        <div className="text-xs">
                          {cwaManager.testResult.message || cwaManager.testResult.error}
                        </div>
                        {cwaManager.testResult.version && (
                          <div className="text-xs">Version: {cwaManager.testResult.version}</div>
                        )}
                        {cwaManager.testResult.warning && (
                          <div className="text-xs text-yellow-600">{cwaManager.testResult.warning}</div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {/* Save Result */}
                  {cwaManager.saveSuccess && (
                    <div className="text-sm text-green-600 flex items-center gap-2">
                      <Check className="w-4 h-4" />
                      CWA settings saved successfully!
                    </div>
                  )}
                  
                  {cwaManager.saveError && (
                    <div className="text-sm text-red-600 flex items-center gap-2">
                      <X className="w-4 h-4" />
                      Failed to save CWA settings
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Google Books API Settings */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Google Books API</h2>
          <p className="text-sm text-muted-foreground">
            Add your Google Books API key to get enhanced book information including descriptions, ratings, and additional metadata.
          </p>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                API Key
                <a 
                  href="https://developers.google.com/books/docs/v1/getting_started#auth" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="ml-2 text-primary hover:underline inline-flex items-center"
                >
                  <ExternalLink className="w-3 h-3 ml-1" />
                  Get API Key
                </a>
              </label>
              <div className="flex space-x-2">
                <div className="relative flex-1">
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={googleBooksKey}
                    onChange={(e) => {
                      setGoogleBooksKey(e.target.value)
                      setKeyStatus('unchecked')
                    }}
                    placeholder="Enter your Google Books API key"
                    className="w-full px-3 py-2 pr-20 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3 space-x-1">
                    {keyStatus === 'valid' && (
                      <Check className="w-4 h-4 text-green-600" />
                    )}
                    {keyStatus === 'invalid' && (
                      <X className="w-4 h-4 text-red-600" />
                    )}
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <Button 
                  variant="outline" 
                  onClick={() => testApiKey(googleBooksKey)}
                  disabled={isTestingKey || !googleBooksKey.trim()}
                >
                  {isTestingKey ? 'Testing...' : 'Test'}
                </Button>
              </div>
              {keyStatus === 'valid' && (
                <p className="text-sm text-green-600 mt-1 flex items-center">
                  <Check className="w-3 h-3 mr-1" />
                  API key is valid and working
                </p>
              )}
              {keyStatus === 'invalid' && (
                <p className="text-sm text-red-600 mt-1 flex items-center">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  API key is invalid or has insufficient permissions
                </p>
              )}
            </div>

            <div className="flex space-x-4">
              <Button 
                onClick={saveGoogleBooksSettings}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save Google Books Settings'}
              </Button>
              {saveMessage && (
                <p className={`text-sm flex items-center ${
                  saveMessage.includes('successfully') ? 'text-green-600' : 'text-red-600'
                }`}>
                  {saveMessage.includes('successfully') ? 
                    <Check className="w-3 h-3 mr-1" /> : 
                    <AlertCircle className="w-3 h-3 mr-1" />
                  }
                  {saveMessage}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Download Settings */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Download Settings</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Download Directory</label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value="/Users/username/Downloads/Books"
                  className="flex-1 px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  readOnly
                />
                <Button variant="outline">Browse</Button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Concurrent Downloads</label>
              <select defaultValue="3" className="w-32 px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Preferred Format</label>
              <select defaultValue="epub" className="w-32 px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="epub">EPUB</option>
                <option value="pdf">PDF</option>
                <option value="mobi">MOBI</option>
                <option value="any">Any</option>
              </select>
            </div>
          </div>
        </div>

        {/* Notification Settings */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Notifications</h2>
          
          <div className="space-y-3">
            <label className="flex items-center space-x-3">
              <input type="checkbox" defaultChecked className="rounded" />
              <span className="text-sm">Notify when downloads complete</span>
            </label>
            
            <label className="flex items-center space-x-3">
              <input type="checkbox" defaultChecked className="rounded" />
              <span className="text-sm">Notify when downloads fail</span>
            </label>
            
            <label className="flex items-center space-x-3">
              <input type="checkbox" className="rounded" />
              <span className="text-sm">Daily summary notifications</span>
            </label>
          </div>
        </div>

        {/* Advanced Settings */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Advanced</h2>
          
          <div className="space-y-3">
            <label className="flex items-center space-x-3">
              <input type="checkbox" className="rounded" />
              <span className="text-sm">Enable debug logging</span>
            </label>
            
            <label className="flex items-center space-x-3">
              <input type="checkbox" defaultChecked className="rounded" />
              <span className="text-sm">Auto-retry failed downloads</span>
            </label>
            
            <label className="flex items-center space-x-3">
              <input type="checkbox" defaultChecked className="rounded" />
              <span className="text-sm">Check for updates automatically</span>
            </label>
          </div>
        </div>
      </div>

      <div className="flex space-x-4">
        <Button>Save Changes</Button>
        <Button variant="outline">Reset to Defaults</Button>
      </div>
    </div>
  )
}
