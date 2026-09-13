import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface ClickToZoomImageProps {
  src: string;
  alt: string;
  className?: string;
}

export function ClickToZoomImage({ src, alt, className }: ClickToZoomImageProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full cursor-zoom-in"
        title="Clique para ampliar"
      >
        <img src={src} alt={alt} className={className} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-auto p-2">
          <DialogHeader>
            <DialogTitle className="sr-only">{alt}</DialogTitle>
          </DialogHeader>
          <img src={src} alt={alt} className="h-auto w-full" />
        </DialogContent>
      </Dialog>
    </>
  );
}
