import { scene } from "./world"
import { loader } from "./loadingManager"

import * as THREE from "three"

let lakeShaderMaterial, lake, mountainMaterial, skyUniforms

const debugObject = {}
debugObject.depthColor = "#186691"
debugObject.surfaceColor = "#9bd8ff"

function mountEnvironment(modelUrl, callback) {
	loader.load(modelUrl, (gltf) => {
		let env = gltf.scene
		env.position.set(20, -0.5, -50)
		env.scale.set(4, 4, 4)
		scene.add(env)

		addLake()
		addMountains()
		addSky()

		callback()
	})
}

function addLake() {
	// Vertex Shader
	const lakeVertexShader = `
uniform float uTime;
uniform float uBigWavesElevation;
uniform vec2 uBigWavesFrequency;
uniform float uBigWavesSpeed;

uniform float uSmallWavesElevation;
uniform float uSmallWavesFrequency;
uniform float uSmallWavesSpeed;
uniform float uSmallWavesIteration;

varying float vElevation;

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


void main(){
    vec4 modelPosition = modelMatrix * vec4(position , 1.0);

    float elevationVariable = sin(modelPosition.x * uBigWavesFrequency.x + uTime * uBigWavesSpeed)
                            *sin(modelPosition.z * uBigWavesFrequency.y + uTime * uBigWavesSpeed) * uBigWavesElevation;

    for(float i = 1.0 ; i<= uSmallWavesIteration ; i++){
        elevationVariable -= abs(cnoise(vec3(
        modelPosition.xz * uSmallWavesFrequency * i ,uTime * uSmallWavesSpeed
    )) * uSmallWavesElevation/i);
    }



    modelPosition.y += elevationVariable ;

    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projectedPosition = projectionMatrix * viewPosition;

    gl_Position = projectedPosition;

    vElevation = elevationVariable;
}
    `

	// Fragment Shader
	const lakeFragmentShader = `
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
    `

	// Shader Material
	lakeShaderMaterial = new THREE.ShaderMaterial({
		vertexShader: lakeVertexShader,
		fragmentShader: lakeFragmentShader,
		uniforms: {
			uTime: {
				value: 0,
			},

			uBigWavesElevation: {
				value: 0.1,
			},
			uBigWavesFrequency: {
				value: new THREE.Vector2(0.25, 0.125),
			},
			uBigWavesSpeed: {
				value: 0.25,
			},

			uSmallWavesElevation: {
				value: 0.05,
			},
			uSmallWavesFrequency: {
				value: 1,
			},
			uSmallWavesSpeed: {
				value: 0.1,
			},
			uSmallWavesIteration: {
				value: 2,
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
	})

	// Update the material of your plane

	let lakeGeometry = new THREE.PlaneGeometry(100, 100, 512, 512)
	lake = new THREE.Mesh(lakeGeometry, lakeShaderMaterial)
	lake.rotateX(-Math.PI / 2)
	lake.position.set(0, -1.5, -54.5)
	scene.add(lake)
}

function addMountains() {
	const mountainGeometry = new THREE.PlaneGeometry(400, 200, 256 * 2, 128 * 2) // More segments for detail
	mountainGeometry.rotateX(-Math.PI / 2) // Rotate to lay it flat

	let mountainVertexShader = `

            uniform float uTime;
            uniform float uBigWavesElevation;
            uniform vec2 uBigWavesFrequency;
            uniform float uBigWavesSpeed;

            uniform float uSmallWavesElevation;
            uniform float uSmallWavesFrequency;
            uniform float uSmallWavesSpeed;
            uniform float uSmallWavesIteration;

            varying float vElevation;

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

            vec2 fade(vec2 t) {return t*t*t*(t*(t*6.0-15.0)+10.0);}

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



            void main() {
                vec4 modelPosition = modelMatrix * vec4(position , 1.0);

                float elevationVariable = sin(modelPosition.x * .2 )
                                        *sin(modelPosition.z * .12
                 ) * uBigWavesElevation;

                for(float i = 1.0 ; i<= uSmallWavesIteration ; i++){
                    elevationVariable -= abs(cnoise(vec3(
                    modelPosition.x  * i , modelPosition.z * i , modelPosition.y
                )) * uSmallWavesElevation/i);
                }



                modelPosition.y += elevationVariable ;

                vec4 viewPosition = viewMatrix * modelPosition;
                vec4 projectedPosition = projectionMatrix * viewPosition;

                gl_Position = projectedPosition;

                vElevation = elevationVariable;
            }

        `

	let mountainFragmentShader =
		//basic fragment shader
		`
            varying float vElevation;

            void main() {
                // Define colors for different elevations
                vec3 baseColor = vec3(0.5, 0.5, 0.2); // Green for lower elevations
                vec3 midColor = vec3(0.5, 0.4, 0.2);  // Brown for middle elevations
                vec3 highColor = vec3(0.5, 0.5, 0.5); // Gray for higher elevations
                vec3 snowColor = vec3(1.0, 1.0, 1.0); // White for snow-capped peaks

                // Define elevation thresholds
                float midElevation = 1.5;
                float highElevation = 4.0;
                float snowElevation = 4.5;

                // Interpolate colors based on elevation
                vec3 color;
                if (vElevation < midElevation) {
                    color = mix(baseColor, midColor, vElevation / midElevation);
                } else if (vElevation < highElevation) {
                    color = mix(midColor, highColor, (vElevation - midElevation) / (highElevation - midElevation));
                } else {
                    color = mix(highColor, snowColor, (vElevation - highElevation) / (snowElevation - highElevation));
                }

                gl_FragColor = vec4(color, 1.0);
            }

            `

	mountainMaterial = new THREE.ShaderMaterial({
		vertexShader: mountainVertexShader /* your vertex shader code */,
		fragmentShader: mountainFragmentShader /* basic fragment shader code */,
		// Add uniforms if needed
		uniforms: {
			uBigWavesElevation: {
				value: 5.25,
			},
			uBigWavesFrequency: {
				value: new THREE.Vector2(0.25, 0.125),
			},
			uBigWavesSpeed: {
				value: 0.25,
			},

			uSmallWavesElevation: {
				value: 1.3,
			},
			uSmallWavesFrequency: {
				value: 1,
			},
			uSmallWavesSpeed: {
				value: 0.1,
			},
			uSmallWavesIteration: {
				value: 8,
			},
		},
	})

	const mountain = new THREE.Mesh(mountainGeometry, mountainMaterial)
	mountain.position.set(0, 1, -125)
	mountain.scale.set(1, 0.75, 0.1)
	mountain.rotateY(Math.PI)
	scene.add(mountain)
}

function addSky() {
	const skyGeometry = new THREE.PlaneGeometry(400, 100, 16, 16)
	// skyGeometry.rotateX(-Math.PI / 2);
	skyGeometry.translate(0, 0, -150)

	const skyVertexShader = `
            varying vec2 vUv;

            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
            `

	const skyFragmentShader = `
            varying vec2 vUv;
            uniform vec3 topColor;
            uniform vec3 bottomColor;

            void main() {
                vec3 finalColor = mix(bottomColor, topColor, vUv.y);
                gl_FragColor = vec4(finalColor, 1.0);
            }
            `

	skyUniforms = {
		topColor: { value: new THREE.Color(0x0a0a0a) }, //0x141d21
		bottomColor: { value: new THREE.Color(0x5c92ed) }, //0x2b1d03
	}

	const skyMaterial = new THREE.ShaderMaterial({
		uniforms: skyUniforms,
		vertexShader: skyVertexShader,
		fragmentShader: skyFragmentShader,
		side: THREE.DoubleSide,
	})

	const sky = new THREE.Mesh(skyGeometry, skyMaterial)
	scene.add(sky)
}

const clock = new THREE.Clock()

const animateOcean = () => {
	if (!lake) return
	const elapsedTime = clock.getElapsedTime()
	requestAnimationFrame(animateOcean.bind(lakeShaderMaterial))
	lakeShaderMaterial.uniforms.uTime.value = elapsedTime
	// mountainMaterial.uniforms.uTime.value = elapsedTime
	// renderer.render(scene, camera)
}

export { mountEnvironment, animateOcean }
