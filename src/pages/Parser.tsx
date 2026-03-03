import { motion } from "framer-motion";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

const Parser = () => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex-1 flex flex-col h-full"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Парсер</h1>
          <p className="text-sm text-muted-foreground font-body">Анализ контента</p>
        </div>
        <Button variant="outline" size="icon" className="h-9 w-9">
          <Upload className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-muted-foreground font-body text-sm">
          Загрузите книгу для анализа структуры
        </p>
      </div>
    </motion.div>
  );
};

export default Parser;
