import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiRequest } from '../lib/utils'

export interface CalibreStatus {
  available: boolean
  database_path: string | null
  configured: boolean
}

export interface BookExistenceMap {
  [bookId: string]: boolean
}

export interface BookCheckRequest {
  books: Array<{
    id: string
    title: string
    author?: string
  }>
}

// Hook to get Calibre database status
export function useCalibreStatus() {
  return useQuery<CalibreStatus>({
    queryKey: ['calibre', 'status'],
    queryFn: async () => {
      const response = await apiRequest('/api/calibre/status')
      return response
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1
  })
}

// Hook to check if books exist in Calibre library
export function useCalibreBookCheck() {
  const queryClient = useQueryClient()
  
  return useMutation<BookExistenceMap, Error, BookCheckRequest>({
    mutationFn: async (data: BookCheckRequest) => {
      const response = await apiRequest('/api/calibre/check', {
        method: 'POST',
        body: JSON.stringify(data)
      })
      return response.exists
    },
    onSuccess: (data, variables) => {
      // Cache individual book existence results
      Object.entries(data).forEach(([bookId, exists]) => {
        queryClient.setQueryData(
          ['calibre', 'book-exists', bookId],
          exists
        )
      })
    }
  })
}

// Hook to get cached book existence status
export function useBookInLibrary(bookId: string) {
  return useQuery<boolean>({
    queryKey: ['calibre', 'book-exists', bookId],
    queryFn: () => false, // Default to false, will be updated by batch checks
    enabled: false, // Only updated through cache, never fetched directly
    staleTime: Infinity, // Cache indefinitely until manually updated
  })
}

// Hook to batch check multiple books
export function useBatchBookCheck(books: Array<{ id: string; title: string; author?: string }>) {
  const checkBooks = useCalibreBookCheck()
  const { data: calibreStatus } = useCalibreStatus()
  
  const checkBooksInLibrary = async () => {
    if (!calibreStatus?.available || books.length === 0) {
      return {}
    }
    
    try {
      return await checkBooks.mutateAsync({ books })
    } catch (error) {
      console.error('Failed to check books in library:', error)
      return {}
    }
  }
  
  return {
    checkBooksInLibrary,
    isLoading: checkBooks.isPending,
    error: checkBooks.error
  }
}
