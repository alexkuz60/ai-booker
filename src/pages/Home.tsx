import { motion } from "framer-motion";
import heroImg from "@/assets/booker_home_half.webp";
import logoImg from "@/assets/logo.png";
import { useSidebar } from "@/components/ui/sidebar";

const Home = () => {
  const { toggleSidebar } = useSidebar();

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
      <div className="relative z-10 flex justify-end h-full p-6 pt-5">
        <div className="flex items-start gap-3">
          <div className="text-right">
            <h1 className="font-display text-5xl font-bold text-foreground drop-shadow-lg leading-tight">
              Ai Booker Studio
            </h1>
            <p className="text-muted-foreground font-body text-[1.05rem] tracking-wide drop-shadow mt-1">
              Начитано эмоционально. Сведено профессионально.
            </p>
          </div>
          <button
            onClick={toggleSidebar}
            className="mt-1 shrink-0 rounded-lg overflow-hidden hover:opacity-80 transition-opacity focus:outline-none"
            aria-label="Открыть меню"
          >
            <img src={logoImg} alt="AI Booker logo" className="h-12 w-12" />
          </button>
        </div>
      </div>
    </motion.div>
  );
};

export default Home;
