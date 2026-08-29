import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // จุดสำคัญคือบรรทัดด้านล่างนี้ ต้องตรงกับชื่อ Repository บน GitHub
  base: '/Demand-Forecasting-Paper/', 
})
