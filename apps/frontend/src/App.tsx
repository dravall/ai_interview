import "styles/globals.css"
import { Form } from "./components/Form";
import { Interview } from "./components/Interview";
import { Result } from "./components/Result";
import { BrowserRouter, Routes, Route } from "react-router";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Form />} />
        <Route path="/interview/:interviewId" element={<Interview />} />
        <Route path="/result/:interviewId" element={<Result />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
