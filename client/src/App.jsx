import ToastRegion from './components/ToastRegion.jsx';
import FloatingAssistant from './components/FloatingAssistant.jsx';
import AppRoutes from './routes/AppRoutes.jsx';

export default function App() {
  return (
    <div className="min-h-screen lg:flex lg:items-start">
      <div className="min-w-0 flex-1">
        <AppRoutes />
      </div>
      <FloatingAssistant />
      <ToastRegion />
    </div>
  );
}
