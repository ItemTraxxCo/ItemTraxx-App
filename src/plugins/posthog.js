import posthog from 'posthog-js'

export default {  
  install(app) {  
    posthog.init(import.meta.env.VITE_POSTHOG_TOKEN, {  
      api_host: 'https://us.i.posthog.com',  
      defaults: '2026-01-30'  
    })

    app.config.globalProperties.$posthog = posthog  
  }  
}  