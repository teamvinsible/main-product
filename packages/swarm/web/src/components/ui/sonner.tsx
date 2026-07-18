import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Dark, themed toaster wired to the app's design tokens.
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "group border border-border bg-card text-card-foreground text-xs rounded-md shadow-lg",
          description: "text-muted-foreground",
          actionButton: "bg-primary text-primary-foreground",
          cancelButton: "bg-secondary text-muted-foreground",
          error: "border-destructive/40",
          success: "border-success/40",
        },
      }}
      {...props}
    />
  );
}
