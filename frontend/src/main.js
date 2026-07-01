import { createApp } from 'vue'
import App from './App.vue'
import '../src/assets/css/stylesheet.css'
import router from './router/router.js'

const app = createApp(App)
app.use(router).mount('#app')
