import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useConvexAuth } from "convex/react";
import { ThemeProvider } from "./hooks/useTheme";
import { AuthPage } from "./components/auth/AuthPage";
import { ChatPage } from "./pages/ChatPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { GoogleDriveCallbackPage } from "./pages/GoogleDriveCallbackPage";

function AppContent() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            isAuthenticated ? <ChatPage /> : <Navigate to="/auth" replace />
          }
        />
        <Route
          path="/documents"
          element={
            isAuthenticated ? (
              <DocumentsPage />
            ) : (
              <Navigate to="/auth" replace />
            )
          }
        />
        <Route
          path="/settings"
          element={
            isAuthenticated ? (
              <SettingsPage />
            ) : (
              <Navigate to="/auth" replace />
            )
          }
        />
        <Route
          path="/google-drive/callback"
          element={<GoogleDriveCallbackPage />}
        />
        <Route
          path="/auth/*"
          element={
            isAuthenticated ? <Navigate to="/" replace /> : <AuthPage />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

export default App;
