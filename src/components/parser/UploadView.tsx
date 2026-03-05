import { RefObject } from "react";
import { motion } from "framer-motion";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { t } from "@/pages/parser/i18n";

interface UploadViewProps {
  isRu: boolean;
  fileInputRef: RefObject<HTMLInputElement>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function UploadView({ isRu, fileInputRef, onFileSelect }: UploadViewProps) {
  return (
    <motion.div key="upload" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
      className="flex-1 flex items-center justify-center h-full">
      <Card className="w-full max-w-md cursor-pointer border-dashed border-2 hover:border-primary/50 transition-colors"
        onClick={() => fileInputRef.current?.click()}>
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="h-16 w-16 rounded-2xl gradient-cyan flex items-center justify-center shadow-cool">
            <Upload className="h-8 w-8 text-primary-foreground" />
          </div>
          <div className="text-center">
            <p className="font-display font-semibold text-lg text-foreground">{t("uploadTitle", isRu)}</p>
            <p className="text-sm text-muted-foreground mt-1">{t("uploadHint", isRu)}</p>
          </div>
          <Button variant="outline" size="lg">
            <Upload className="h-4 w-4 mr-2" />
            {t("selectFile", isRu)}
          </Button>
        </CardContent>
      </Card>
      <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={onFileSelect} />
    </motion.div>
  );
}
