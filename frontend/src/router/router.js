import { createRouter, createWebHashHistory } from 'vue-router'
import AllFilesPanel from '../components/AllFilesPanel.vue'
import ClipboardPanel from '../components/ClipboardPanel.vue'
import UploadByToken from '../components/UploadByToken.vue'

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/files' },
    { path: '/files', name: 'files', component: AllFilesPanel },
    { path: '/clipboard', name: 'clipboard', component: ClipboardPanel },
    {
      path: '/upload',
      name: 'upload-token',
      component: UploadByToken,
      props: (route) => ({ token: route.query.token || '' })
    },
  ],
})

export default router
