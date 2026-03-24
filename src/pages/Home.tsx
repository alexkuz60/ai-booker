import { motion } from "framer-motion";
import heroImg from "@/assets/booker_home_half.webp";
import { useLanguage } from "@/hooks/useLanguage";

const Home = () => {
  const { isRu } = useLanguage();
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="relative h-full overflow-hidden"
    >
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: `url(${heroImg})`,
          backgroundSize: "auto 100%",
          backgroundPosition: "center center",
          backgroundRepeat: "no-repeat",
        }}
      />
      <div className="absolute inset-0 bg-background/40" />
      <div className="relative z-10 flex justify-start h-full p-6 pt-5">
        <div className="text-left">
          <h1 className="font-display text-5xl font-bold text-foreground drop-shadow-lg leading-tight">
            Ai Booker Studio
          </h1>
          <p className="text-muted-foreground font-body text-[0.84rem] font-bold tracking-wide drop-shadow mt-1">
            {isRu ? "Начитано эмоционально. Сведено профессионально." : "Emotionally dictated. Professionally mixed."}
          </p>
        </div>
      </div>
    </motion.div>
  );
};

export default Home;
