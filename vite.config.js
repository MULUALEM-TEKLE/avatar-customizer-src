const isCodeSandbox = 'SANDBOX_URL' in process.env || 'CODESANDBOX_HOST' in process.env

export default {
    root: 'src/',
    publicDir: '../static/',
    // Root-absolute, because every runtime asset URL in config.js is
    // root-absolute. './' would advertise a relocatable build that 404s on
    // every model, thumbnail and audio file outside the domain root.
    base: '/',
    server:
    {
        host: true,
        open: !isCodeSandbox // Open if it's not a CodeSandbox
    },
    build:
    {
        outDir: '../dist',
        emptyOutDir: true,
        sourcemap: true
    }
}