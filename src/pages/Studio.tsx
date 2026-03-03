import { motion } from "framer-motion";

const Studio = () => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex-1 p-8"
    >
      <h1 className="font-display text-3xl font-bold text-foreground mb-2">Студия</h1>
      <p className="text-muted-foreground font-body">Рабочая панель студии</p>
    </motion.div>
  );
};

export default Studio;
