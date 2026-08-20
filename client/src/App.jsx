import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { ToastContainer } from './components/ui/Toast';
import { useVersionCheck } from './hooks/useVersionCheck';

function App() {
  // Chequeo periódico de /version.json. Si la versión publicada en el
  // server no coincide con la baked-in del bundle, dispara el toast
  // "Nueva versión X disponible" con botón "Actualizar".
  useVersionCheck();

  return (
    <>
      <RouterProvider router={router} />
      <ToastContainer />
    </>
  );
}

export default App;
