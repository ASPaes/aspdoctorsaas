import { createRoot } from "react-dom/client";
import { AuthProvider } from "./contexts/AuthContext";
import App from "./App";
import "./index.css";
import { bootstrapAccentColor } from "@/lib/accentColor";

// Antes do primeiro render: senão o app monta verde e troca de cor quando as
// preferências respondem (DEM-0103).
bootstrapAccentColor();

createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <App />
  </AuthProvider>
);
