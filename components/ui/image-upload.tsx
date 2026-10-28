"use client";

import { useState, useCallback } from 'react';
import { Upload, X, Loader2, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { UPLOAD_FOLDERS, type UploadFolder } from '@/lib/cloudinary';

interface ImageUploadProps {
  value?: string; // Cloudinary URL or public ID
  onChange: (url: string | undefined) => void;
  folder?: UploadFolder;
  className?: string;
  disabled?: boolean;
  aspectRatio?: 'square' | 'video' | 'portrait';
}

export function ImageUpload({
  value,
  onChange,
  folder = 'players',
  className,
  disabled,
  aspectRatio = 'square',
}: ImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const aspectClasses = {
    square: 'aspect-square',
    video: 'aspect-video',
    portrait: 'aspect-[3/4]',
  };

  const handleUpload = useCallback(async (file: File) => {
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      toast.error('Invalid file type. Please upload JPG, PNG or WebP');
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File is too large. Maximum size is 5MB');
      return;
    }

    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', UPLOAD_FOLDERS[folder]);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const data = await response.json();
      onChange(data.url);
      toast.success('Image uploaded successfully!');
    } catch (error) {
      console.error('Upload error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to upload image');
    } finally {
      setIsUploading(false);
    }
  }, [folder, onChange]);

  const handleRemove = useCallback(async () => {
    onChange(undefined);
    toast.success('Image removed');
  }, [onChange]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (disabled || isUploading) return;

    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleUpload(file);
    }
  }, [disabled, isUploading, handleUpload]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !isUploading) {
      setDragActive(true);
    }
  }, [disabled, isUploading]);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleUpload(file);
    }
    // Reset input
    e.target.value = '';
  }, [handleUpload]);

  if (value) {
    return (
      <div className={cn('relative group', className)}>
        <div className={cn(
          'relative overflow-hidden rounded-xl border border-slate-600 bg-slate-800/30',
          aspectClasses[aspectRatio]
        )}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Uploaded image"
            className="w-full h-full object-cover"
          />
          
          {/* Overlay on hover */}
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <button
              type="button"
              onClick={handleRemove}
              disabled={disabled}
              className="p-2 bg-red-500 hover:bg-red-600 rounded-full transition-colors disabled:opacity-50"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative cursor-pointer',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <label
        className={cn(
          'flex flex-col items-center justify-center w-full rounded-xl border-2 border-dashed transition-all cursor-pointer',
          aspectClasses[aspectRatio],
          dragActive
            ? 'border-blue-500 bg-blue-500/10'
            : 'border-slate-600 hover:border-blue-500 hover:bg-slate-800/50',
          disabled && 'cursor-not-allowed'
        )}
      >
        <div className="flex flex-col items-center justify-center p-4 text-center">
          {isUploading ? (
            <>
              <Loader2 className="w-8 h-8 mb-2 text-blue-400 animate-spin" />
              <p className="text-sm text-slate-400">Uploading...</p>
            </>
          ) : (
            <>
              {dragActive ? (
                <Upload className="w-8 h-8 mb-2 text-blue-400" />
              ) : (
                <ImageIcon className="w-8 h-8 mb-2 text-slate-400 group-hover:text-blue-400 transition-colors" />
              )}
              <p className="text-sm text-slate-400">
                <span className="font-semibold text-blue-400">Click to upload</span>
                {' '}or drag and drop
              </p>
              <p className="text-xs text-slate-500 mt-1">PNG, JPG, WebP (max 5MB)</p>
            </>
          )}
        </div>
        
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          disabled={disabled || isUploading}
          onChange={handleFileSelect}
        />
      </label>
    </div>
  );
}
