import { useCallback, useRef } from "react";
import { Upload, Camera } from "lucide-react";

interface PhotoUploadProps {
  onImageSelect: (imageUrl: string) => void;
  currentImage: string | null;
}

const PhotoUpload = ({ onImageSelect, currentImage }: PhotoUploadProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (file && file.type.startsWith("image/")) {
        const url = URL.createObjectURL(file);
        onImageSelect(url);
      }
    },
    [onImageSelect]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      onClick={() => fileInputRef.current?.click()}
      className={`relative rounded-xl border-2 border-dashed border-border cursor-pointer transition-all duration-300 hover:border-primary/50 hover:bg-primary/5 overflow-hidden ${
        currentImage ? "aspect-[4/3]" : "aspect-[4/3] flex items-center justify-center"
      }`}
    >
      {currentImage ? (
        <img
          src={currentImage}
          alt="Uploaded room"
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="flex flex-col items-center gap-3 text-muted-foreground p-8">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Upload className="w-7 h-7 text-primary" />
          </div>
          <div className="text-center">
            <p className="font-medium text-foreground">Drop your room photo here</p>
            <p className="text-sm mt-1">or click to browse</p>
          </div>
          <div className="flex items-center gap-2 mt-2 text-xs">
            <Camera className="w-4 h-4" />
            <span>JPG, PNG supported</span>
          </div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
    </div>
  );
};

export default PhotoUpload;
