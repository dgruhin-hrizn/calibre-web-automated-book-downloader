// React hooks for Calibre library management
// Direct database access to local Calibre library

import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../lib/utils';

// Types
export interface LibraryBook {
  id: number;
  title: string;
  author: string;
  timestamp: string;
  path: string;
  has_cover: boolean;
  series?: string;
  formats: string[];
  tags?: string[];
  comments?: string;
  pubdate?: string;
  isbn?: Record<string, string>;
}

export interface LibraryBooksResponse {
  books: LibraryBook[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
  limit: number;
  offset: number;
}

export interface LibraryStatus {
  available: boolean;
  library_path?: string;
  cwa_db_available: boolean;
  error?: string;
}

export interface LibrarySearchResponse {
  books: LibraryBook[];
  total: number;
  query: string;
}

// Hooks

/**
 * Check library status and availability
 */
export function useLibraryStatus() {
  return useQuery<LibraryStatus>({
    queryKey: ['library', 'status'],
    queryFn: () => apiRequest('/api/library/status'),
    staleTime: 30000, // 30 seconds
    retry: 2,
  });
}

/**
 * Get books from library with pagination
 */
export function useLibraryBooks(page = 1, perPage = 25, sort = 'id', search = '') {
  return useQuery<LibraryBooksResponse>({
    queryKey: ['library', 'books', { page, perPage, sort, search }],
    queryFn: () => apiRequest('/api/library/books', {
      method: 'GET',
      params: { page, per_page: perPage, sort, search: search || undefined }
    }),
    enabled: page > 0, // Only run if page is valid
    staleTime: 60000, // 1 minute
  });
}

/**
 * Get detailed book information
 */
export function useLibraryBookDetails(bookId: number | null) {
  return useQuery<LibraryBook>({
    queryKey: ['library', 'book', bookId],
    queryFn: () => apiRequest(`/api/library/books/${bookId}`),
    enabled: !!bookId,
    staleTime: 300000, // 5 minutes
  });
}

/**
 * Search books in library
 */
export function useLibrarySearch() {
  return useMutation<LibrarySearchResponse, Error, { query: string; limit?: number }>({
    mutationFn: ({ query, limit = 25 }) => 
      apiRequest('/api/library/search', {
        method: 'GET',
        params: { q: query, limit }
      }),
  });
}

/**
 * Download a book from the library
 */
export function useLibraryDownloadBook() {
  return useMutation<Blob, Error, { bookId: number; format: string }>({
    mutationFn: async ({ bookId, format }) => {
      const response = await fetch(`/api/library/books/${bookId}/download/${format}`, {
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
      }
      
      return response.blob();
    },
  });
}

/**
 * Get book cover URL
 */
export function useLibraryBookCover(bookId: number | null) {
  return useQuery<{ cover_url: string }>({
    queryKey: ['library', 'book', bookId, 'cover'],
    queryFn: async () => {
      // For library books, we construct the cover URL directly
      return { cover_url: `/api/library/books/${bookId}/cover` };
    },
    enabled: !!bookId,
    staleTime: 3600000, // 1 hour (covers don't change often)
  });
}

/**
 * Combined hook for library management
 */
export function useLibraryManager() {
  const status = useLibraryStatus();
  const search = useLibrarySearch();
  const download = useLibraryDownloadBook();
  
  return {
    // Library status
    isAvailable: status.data?.available ?? false,
    libraryPath: status.data?.library_path,
    cwaDbAvailable: status.data?.cwa_db_available ?? false,
    statusLoading: status.isLoading,
    statusError: status.error,
    
    // Search functionality
    searchBooks: search.mutate,
    searchResults: search.data,
    isSearching: search.isPending,
    searchError: search.error,
    
    // Download functionality
    downloadBook: download.mutate,
    isDownloading: download.isPending,
    downloadError: download.error,
    
    // Utility functions
    refetchStatus: status.refetch,
    resetSearch: search.reset,
  };
}

/**
 * Hook for library pagination
 */
export function useLibraryPagination(initialPage = 1, initialPerPage = 25) {
  const queryClient = useQueryClient();
  
  const [page, setPage] = React.useState(initialPage);
  const [perPage, setPerPage] = React.useState(initialPerPage);
  const [sort, setSort] = React.useState('id');
  const [search, setSearch] = React.useState('');
  
  const books = useLibraryBooks(page, perPage, sort, search);
  
  const goToPage = (newPage: number) => {
    setPage(newPage);
  };
  
  const changePerPage = (newPerPage: number) => {
    setPerPage(newPerPage);
    setPage(1); // Reset to first page when changing per page
  };
  
  const changeSort = (newSort: string) => {
    setSort(newSort);
    setPage(1); // Reset to first page when changing sort
  };
  
  const changeSearch = (newSearch: string) => {
    setSearch(newSearch);
    setPage(1); // Reset to first page when searching
  };
  
  const clearSearch = () => {
    setSearch('');
    setPage(1);
  };
  
  const invalidateBooks = () => {
    queryClient.invalidateQueries({ queryKey: ['library', 'books'] });
  };
  
  return {
    // Current state
    books: books.data?.books || [],
    total: books.data?.total || 0,
    totalPages: books.data?.total_pages || 0,
    page,
    perPage,
    sort,
    search,
    
    // Loading states
    isLoading: books.isLoading,
    error: books.error,
    
    // Actions
    goToPage,
    changePerPage,
    changeSort,
    changeSearch,
    clearSearch,
    invalidateBooks,
    
    // Pagination helpers
    hasNextPage: books.data ? page < books.data.total_pages : false,
    hasPreviousPage: page > 1,
    nextPage: () => goToPage(page + 1),
    previousPage: () => goToPage(page - 1),
  };
}

/**
 * Hook to invalidate library-related queries
 */
export function useLibraryInvalidation() {
  const queryClient = useQueryClient();
  
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['library'] });
  };
  
  const invalidateBooks = () => {
    queryClient.invalidateQueries({ queryKey: ['library', 'books'] });
  };
  
  const invalidateBook = (bookId: number) => {
    queryClient.invalidateQueries({ queryKey: ['library', 'book', bookId] });
  };
  
  const invalidateStatus = () => {
    queryClient.invalidateQueries({ queryKey: ['library', 'status'] });
  };
  
  return {
    invalidateAll,
    invalidateBooks,
    invalidateBook,
    invalidateStatus,
  };
}
