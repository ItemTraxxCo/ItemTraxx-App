const origins = Object.freeze({
  'https://mlaspkufocikfcbjgpof.supabase.co': 'https://sgw.itemtraxx.com',
  'https://nwuhjxicaopkmqydjlas.supabase.co': 'https://itemtraxx-sgw-staging.itemtraxx-co.workers.dev',
});

export function gatewayOriginForProject(projectUrl) {
  if (!Object.hasOwn(origins, projectUrl)) throw new Error('Unknown database project');
  return origins[projectUrl];
}
