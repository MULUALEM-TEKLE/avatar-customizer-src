import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader";

let cameraPersp, currentCamera, material, scene, renderer, envMap;
let debugObject = {};
debugObject.depthColor = "#222222";
debugObject.surfaceColor = "#cccccc";

//create a function that creates and sets parameters for the renderer
function createRenderer() {
	renderer = new THREE.WebGLRenderer({
		antialias: true,
	});
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.outputEncoding = THREE.sRGBEncoding;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	document.body.appendChild(renderer.domElement);
}

// functions to create and add camera to the scene
function createCamera() {
	const aspect = window.innerWidth / window.innerHeight;

	cameraPersp = new THREE.PerspectiveCamera(50, aspect, 0.01, 30000);
	currentCamera = cameraPersp;

	currentCamera.position.set(0, 0.25, 2);
	currentCamera.lookAt(0, 0, 0);
}

// function to setup scene and lights
function createSceneAndLights() {
	scene = new THREE.Scene();

	const ambientLight = new THREE.AmbientLight(0xffffff, 0.25);
	scene.add(ambientLight);

	const light = new THREE.DirectionalLight(0xffffff, 1 / 1);
	light.position.set(10, 0, 10);

	const light_ = new THREE.DirectionalLight(0xffffff, 1 / 1);
	light_.position.set(-10, 1, 10);
	scene.add(light, light_);
}

// function to load envmap
function loadEnvMap() {
	new RGBELoader().load("hdri/alps_field_2k.hdr", (texture) => {
		texture.mapping = THREE.EquirectangularReflectionMapping;
		envMap = texture;
	});
}

// function to add the ground mesh with shader material
function addGroundMesh() {
	const geometry = new THREE.PlaneGeometry(20, 5, 800, 200);

	// move it down and rotate it to be a ground
	geometry.rotateX(-Math.PI / 2);
	geometry.translate(0, -1.25, 0);

	const glslFunctions = `
		float bigWaves(vec3 modelPosition, float time, float elevation, vec2 frequency, float speed) {
		return sin(modelPosition.x * frequency.x + time * speed) * sin(modelPosition.z * frequency.y + time * speed) * elevation;
		}

		float smallWaves(vec3 modelPosition, float time, float elevation, float frequency, float speed, int iterations) {
		float smallWavesElevation = 0.0;
		for (int i = 1; i <= 4; i++) {
			smallWavesElevation -= abs(cnoise(vec3(modelPosition.xz * frequency * float(i), time * speed)) * elevation / float(i));
		}
		return smallWavesElevation;
		}

		vec3 blendColors(float elevation, vec3 depthColor, vec3 surfaceColor, float colorOffset, float colorMultiplier) {
		float mixStrength = (elevation + colorOffset) * colorMultiplier;
		return mix(depthColor, surfaceColor, smoothstep(0.0, 1.0, mixStrength));
		}
	`;

	const glslUtilFunctions = `

		// Classic Perlin 3D Noise
		// by Stefan Gustavson
		//
		vec4 permute(vec4 x)
		{
			return mod(((x*34.0)+1.0)*x, 289.0);
		}
		vec4 taylorInvSqrt(vec4 r)
		{
			return 1.79284291400159 - 0.85373472095314 * r;
		}
		vec3 fade(vec3 t)
		{
			return t*t*t*(t*(t*6.0-15.0)+10.0);
		}

		float cnoise(vec3 P)
		{
			vec3 Pi0 = floor(P); // Integer part for indexing
			vec3 Pi1 = Pi0 + vec3(1.0); // Integer part + 1
			Pi0 = mod(Pi0, 289.0);
			Pi1 = mod(Pi1, 289.0);
			vec3 Pf0 = fract(P); // Fractional part for interpolation
			vec3 Pf1 = Pf0 - vec3(1.0); // Fractional part - 1.0
			vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
			vec4 iy = vec4(Pi0.yy, Pi1.yy);
			vec4 iz0 = Pi0.zzzz;
			vec4 iz1 = Pi1.zzzz;

			vec4 ixy = permute(permute(ix) + iy);
			vec4 ixy0 = permute(ixy + iz0);
			vec4 ixy1 = permute(ixy + iz1);

			vec4 gx0 = ixy0 / 7.0;
			vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5;
			gx0 = fract(gx0);
			vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
			vec4 sz0 = step(gz0, vec4(0.0));
			gx0 -= sz0 * (step(0.0, gx0) - 0.5);
			gy0 -= sz0 * (step(0.0, gy0) - 0.5);

			vec4 gx1 = ixy1 / 7.0;
			vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5;
			gx1 = fract(gx1);
			vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
			vec4 sz1 = step(gz1, vec4(0.0));
			gx1 -= sz1 * (step(0.0, gx1) - 0.5);
			gy1 -= sz1 * (step(0.0, gy1) - 0.5);

			vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
			vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
			vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
			vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
			vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
			vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
			vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
			vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);

			vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
			g000 *= norm0.x;
			g010 *= norm0.y;
			g100 *= norm0.z;
			g110 *= norm0.w;
			vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
			g001 *= norm1.x;
			g011 *= norm1.y;
			g101 *= norm1.z;
			g111 *= norm1.w;

			float n000 = dot(g000, Pf0);
			float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
			float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
			float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
			float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
			float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
			float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
			float n111 = dot(g111, Pf1);

			vec3 fade_xyz = fade(Pf0);
			vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
			vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
			float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
			return 2.2 * n_xyz;
		}
	`;

	// create a shader material
	material = new THREE.ShaderMaterial({
		wireframe: true,
		uniforms: {
			uTime: {
				value: 0,
			},

			uAudioFrequency: {
				value: 0,
			},

			uBigWavesElevation: {
				value: 0,
			},
			uBigWavesFrequency: {
				value: new THREE.Vector2(0, 0),
			},
			uBigWavesSpeed: {
				value: 0.5,
			},

			uSmallWavesElevation: {
				value: 0.0125,
			},
			uSmallWavesFrequency: {
				value: 3,
			},
			uSmallWavesSpeed: {
				value: 0.2,
			},
			uSmallWavesIteration: {
				value: 4,
			},

			uDepthColor: {
				value: new THREE.Color(debugObject.depthColor),
			},
			uSurfaceColor: {
				value: new THREE.Color(debugObject.surfaceColor),
			},
			uColorOffset: {
				value: 0.08,
			},
			uColorMultiplier: {
				value: 5,
			},
		},
		vertexShader: `
		uniform float uTime;
		uniform float uBigWavesElevation;
		uniform vec2 uBigWavesFrequency;
		uniform float uBigWavesSpeed;

		uniform float uSmallWavesElevation;
		uniform float uSmallWavesFrequency;
		uniform float uSmallWavesSpeed;
		uniform float uSmallWavesIteration;

		uniform float uAudioFrequency;

		varying float vElevation;

		${glslUtilFunctions}

		${glslFunctions}



		void main(){
			vec4 modelPosition = modelMatrix * vec4(position , 1.0);

			float bigWavesElevation = bigWaves(modelPosition.xyz, uTime, uBigWavesElevation, uBigWavesFrequency, uBigWavesSpeed);
			float smallWavesElevation = smallWaves(modelPosition.xyz, uTime, uSmallWavesElevation, uSmallWavesFrequency, uSmallWavesSpeed, 4);

			float elevationVariable = bigWavesElevation + smallWavesElevation;

			modelPosition.y += elevationVariable;

			modelPosition.y += elevationVariable ;

			vec4 viewPosition = viewMatrix * modelPosition;
			vec4 projectedPosition = projectionMatrix * viewPosition;

			gl_Position = projectedPosition;

			vElevation = elevationVariable;
		}
		`,
		fragmentShader: `
		uniform vec3 uDepthColor;
		uniform vec3 uSurfaceColor;
		uniform float uColorOffset;
		uniform float uColorMultiplier;


		varying float vElevation;

		void main(){
			float mixStrength = (vElevation + uColorOffset) * uColorMultiplier;
			vec3 color = mix(uDepthColor  , uSurfaceColor , mixStrength);
			gl_FragColor = vec4(color , 1.0 );
		}
  `,
	});

	const mesh = new THREE.Mesh(geometry, material);
	mesh.position.set(0, 0, -2);
	scene.add(mesh);
}

function onWindowResize() {
	const aspect = window.innerWidth / window.innerHeight;

	currentCamera.aspect = aspect;
	currentCamera.updateProjectionMatrix();

	renderer.setSize(window.innerWidth, window.innerHeight);

	// render();
}
window.addEventListener("resize", onWindowResize);
function setupWorld() {
	createRenderer();
	createCamera();
	createSceneAndLights();
	loadEnvMap();
	addGroundMesh();
}

export {
	setupWorld,
	cameraPersp,
	currentCamera,
	material,
	scene,
	renderer,
	envMap,
};
