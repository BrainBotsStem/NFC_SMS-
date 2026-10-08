import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Landing from './pages/Landing.jsx';
import Batches from './pages/Batches.jsx';
import BatchDetail from './pages/BatchDetail.jsx';
import Admin from './pages/Admin.jsx';
import Departments from './pages/Departments.jsx';
import DepartmentDetail from './pages/DepartmentDetail.jsx';
import StaffMembers from './pages/StaffMembers.jsx';
import StudentHistory from './pages/StudentHistory.jsx';
import StaffHistory from './pages/StaffHistory.jsx';

export default function App() {
  const { user, ready } = useAuth();

  if (!ready) return null;
  // Signed-out visitors get the public front page, and the sign-in form at /login.
  if (!user)
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );

  // admin sees the student side, staffadmin the staff side, superadmin both.
  const students = user.role === 'admin' || user.role === 'superadmin';
  const staff = user.role === 'staffadmin' || user.role === 'superadmin';

  return (
    <Layout>
      <Routes>
        <Route path="/" element={students ? <Batches /> : <Navigate to="/departments" replace />} />
        {students && <Route path="/batch/:id" element={<BatchDetail />} />}
        {students && <Route path="/admin" element={<Admin />} />}
        {students && <Route path="/student/:id" element={<StudentHistory />} />}
        {staff && <Route path="/departments" element={<Departments />} />}
        {staff && <Route path="/department/:id" element={<DepartmentDetail />} />}
        {staff && <Route path="/staff" element={<StaffMembers />} />}
        {staff && <Route path="/staff-member/:id" element={<StaffHistory />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
