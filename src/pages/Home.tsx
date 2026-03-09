import { motion } from "framer-motion";
import heroImg from "@/assets/booker_home_half.jpeg";

const Home = () => {
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
      <div className="relative z-10 flex items-end h-full p-8 pb-12">
        <div>
          <h1 className="font-display text-4xl font-bold text-foreground mb-2 drop-shadow-lg">
            AI Booker
          </h1>
          <p className="text-muted-foreground font-body text-lg drop-shadow">
            Добро пожаловать в студию аудиокниг
          </p>
        </div>
      </div>
    </motion.div>
  );
};

export default Home;
