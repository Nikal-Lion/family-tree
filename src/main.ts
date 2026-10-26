import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import '@vben-core/design'
import 'ant-design-vue/dist/reset.css'
import './styles/app.css'
import './style.css'

createApp(App).use(router).mount('#app')
