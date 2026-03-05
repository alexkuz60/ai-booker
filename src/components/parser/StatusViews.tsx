import { motion } from "framer-motion";
import { FileText, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { t } from "@/pages/parser/i18n";

interface ExtractingTocViewProps {
  fileName: string;
  isRu: boolean;
}

export function ExtractingTocView({ fileName, isRu }: ExtractingTocViewProps) {
  return (
    <motion.div key="extracting_toc" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
      className="flex items-center justify-center h-full">
      <Card className="w-full max-w-md">
        <CardContent className="py-10 flex flex-col items-center gap-4">
          <FileText className="h-8 w-8 text-primary" />
          <div className="text-center">
            <p className="font-display font-semibold">{fileName}</p>
            <p className="text-sm text-muted-foreground mt-1">{t("searchingToc", isRu)}</p>
          </div>
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    </motion.div>
  );
}

interface ErrorViewProps {
  errorMsg: string;
  isRu: boolean;
  onReset: () => void;
}

export function ErrorView({ errorMsg, isRu, onReset }: ErrorViewProps) {
  return (
    <motion.div key="error" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
      className="flex items-center justify-center h-full">
      <Card className="w-full max-w-md border-destructive/30">
        <CardContent className="py-10 flex flex-col items-center gap-4">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <div className="text-center">
            <p className="font-display font-semibold text-lg">{t("error", isRu)}</p>
            <p className="text-sm text-muted-foreground mt-2 max-w-sm">{errorMsg}</p>
          </div>
          <Button variant="outline" onClick={onReset}>{t("tryAgain", isRu)}</Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}
