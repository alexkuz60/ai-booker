import { motion } from "framer-motion";

const Narrators = () => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex-1 p-8"
    >
      <h1 className="font-display text-3xl font-bold text-foreground mb-2">Дикторы</h1>
      <p className="text-muted-foreground font-body">Библиотека голосов</p>
    </motion.div>
  );
};

export default Narrators;
