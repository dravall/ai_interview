import axios from "axios";
import { BACKEND_URL } from "@/lib/config";

export const api = axios.create({
    baseURL: BACKEND_URL,
    withCredentials: true,
});
