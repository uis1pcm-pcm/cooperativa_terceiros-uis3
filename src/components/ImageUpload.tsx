/**
 * Image Upload Component Example
 * Demonstrates how to use R2 image utilities in a React component
 */

"use client";

import { useState, useRef } from "react";
import {
  uploadImageDirect,
  uploadImageViaPresigned,
  validateImageFile,
  formatFileSize,
  listInspectionImages,
  deleteImage,
} from "@/lib/r2-client";
import type { ImageUploadResponse } from "@/types/r2";
import { toast } from "sonner";

interface ImageUploadProps {
  inspectionId: string;
  onUploadSuccess?: (image: ImageUploadResponse) => void;
}

export function ImageUpload({ inspectionId, onUploadSuccess }: ImageUploadProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [images, setImages] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file
    const validation = validateImageFile(file);
    if (!validation.valid) {
      toast.error(validation.error);
      return;
    }

    setIsLoading(true);
    setUploadProgress(0);

    try {
      // Option 1: Direct upload through the API
      // const result = await uploadImageDirect(file, inspectionId);

      // Option 2: Upload via presigned URL (better for large files)
      const result = await uploadImageViaPresigned(
        file,
        inspectionId,
        (event) => {
          if (event.lengthComputable) {
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        }
      );

      toast.success(`Image uploaded successfully (${formatFileSize(file.size)})`);
      onUploadSuccess?.(result as any);

      // Reload images list
      await loadImages();
    } catch (error: any) {
      toast.error(`Upload failed: ${error.message}`);
    } finally {
      setIsLoading(false);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const loadImages = async () => {
    try {
      const result = await listInspectionImages(inspectionId);
      setImages(result.images || []);
    } catch (error: any) {
      console.error("Failed to load images:", error);
    }
  };

  const handleDeleteImage = async (key: string) => {
    if (!confirm("Delete this image?")) return;

    try {
      await deleteImage(key);
      toast.success("Image deleted");
      await loadImages();
    } catch (error: any) {
      toast.error(`Delete failed: ${error.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload Area */}
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 hover:border-gray-400 transition">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          disabled={isLoading}
          className="hidden"
        />

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
          className="w-full text-center py-4 px-6 bg-blue-50 hover:bg-blue-100 rounded-lg disabled:opacity-50"
        >
          {isLoading ? (
            <div>
              <p className="font-medium">Uploading... {uploadProgress}%</p>
              <div className="mt-2 bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <div>
              <p className="font-medium">Click to upload or drag and drop</p>
              <p className="text-sm text-gray-500">
                JPG, PNG, WebP or GIF (max 10MB)
              </p>
            </div>
          )}
        </button>
      </div>

      {/* Images List */}
      {images.length > 0 && (
        <div>
          <h3 className="font-semibold mb-4">Images ({images.length})</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {images.map((image) => (
              <div key={image.key} className="relative group">
                <img
                  src={image.url}
                  alt={image.key}
                  className="w-full h-32 object-cover rounded-lg"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 rounded-lg transition flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <button
                    onClick={() => handleDeleteImage(image.key)}
                    className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm"
                  >
                    Delete
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1 truncate">
                  {formatFileSize(image.size)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
