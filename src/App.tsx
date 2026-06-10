import { RouterProvider } from "react-router";
import { router } from "./app/routes";
import { useAppSettings } from "./hooks/useAppSettings";

function App() {
  useAppSettings();
  return <RouterProvider router={router} />;
}

export default App;
