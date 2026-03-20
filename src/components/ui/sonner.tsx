import { useTheme } from "next-themes";
import { Toaster as Sonner, toast as sonnerToast, type ExternalToast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

/** Wrapper: error toasts stay until manually dismissed (click ✕) */
const baseToastError = sonnerToast.error.bind(sonnerToast);
const toast = {
  ...sonnerToast,
  error: (message: string | React.ReactNode, opts?: ExternalToast) =>
    baseToastError(message, { duration: Infinity, ...opts }),
};

export { Toaster, toast };
