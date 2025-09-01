// React hooks for managing CWA settings

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../lib/utils';

// Types
export interface CWASettings {
  base_url: string;
  username: string;
  password: string;
  enabled: boolean;
  timeout: number;
  verify_ssl: boolean;
}

export interface CWAConnectionTestResult {
  success: boolean;
  message?: string;
  error?: string;
  warning?: string;
  version?: string;
}

// Default settings
export const defaultCWASettings: CWASettings = {
  base_url: 'http://localhost:8083',
  username: '',
  password: '',
  enabled: false,
  timeout: 30,
  verify_ssl: true,
};

/**
 * Get current CWA settings
 */
export function useCWASettings() {
  return useQuery<CWASettings>({
    queryKey: ['cwa', 'settings'],
    queryFn: () => apiRequest('/api/cwa/settings'),
    staleTime: 60000, // 1 minute
    retry: 2,
  });
}

/**
 * Save CWA settings
 */
export function useSaveCWASettings() {
  const queryClient = useQueryClient();
  
  return useMutation<{ success: boolean; message: string }, Error, Partial<CWASettings>>({
    mutationFn: (settings) => 
      apiRequest('/api/cwa/settings', {
        method: 'POST',
        data: settings
      }),
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['cwa', 'settings'] });
      queryClient.invalidateQueries({ queryKey: ['cwa', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['cwa'] }); // Invalidate all CWA queries
    },
  });
}

/**
 * Test CWA connection
 */
export function useTestCWAConnection() {
  return useMutation<CWAConnectionTestResult, Error, Partial<CWASettings> | undefined>({
    mutationFn: (settings) => 
      apiRequest('/api/cwa/settings/test', {
        method: 'POST',
        data: settings || {}
      }),
  });
}

/**
 * Combined hook for CWA settings management
 */
export function useCWASettingsManager() {
  const settings = useCWASettings();
  const saveSettings = useSaveCWASettings();
  const testConnection = useTestCWAConnection();
  
  return {
    // Current settings
    settings: settings.data || defaultCWASettings,
    isLoading: settings.isLoading,
    error: settings.error,
    
    // Save settings
    saveSettings: saveSettings.mutate,
    savingSettings: saveSettings.isPending,
    saveError: saveSettings.error,
    saveSuccess: saveSettings.isSuccess,
    
    // Test connection
    testConnection: testConnection.mutate,
    testingConnection: testConnection.isPending,
    testResult: testConnection.data,
    testError: testConnection.error,
    
    // Reset functions
    resetSave: saveSettings.reset,
    resetTest: testConnection.reset,
    
    // Refetch settings
    refetchSettings: settings.refetch,
  };
}
