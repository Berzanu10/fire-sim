import * as THREE from 'three';

/**
 * GasDispersionSystem - Gas Dispersion System
 * Creates gas particles that start from the computer and slowly fill the room.
 */
export class GasDispersionSystem {
    constructor(scene, startPosition) {
        this.scene = scene;
        this.startPosition = startPosition ? startPosition.clone() : new THREE.Vector3(0, 1.0, -1.8);
        this.particleCount = 3000;
        this.particles = [];
        this.isStarted = false;
        this.isLeaking = true; // Added to control source leak
        
        this.geometry = new THREE.BufferGeometry();
        this.positions = new Float32Array(this.particleCount * 3);
        this.opacities = new Float32Array(this.particleCount);
        this.sizes = new Float32Array(this.particleCount);
        
        for (let i = 0; i < this.particleCount; i++) {
            this.resetParticle(i);
            
            this.particles[i] = {
                velocity: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.02,
                    (Math.random() - 0.2) * 0.015, 
                    (Math.random() - 0.5) * 0.02
                ),
                startTime: Math.random() * 10,
                active: false,
                externalForce: new THREE.Vector3(0, 0, 0)
            };
        }
        
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute('opacity', new THREE.BufferAttribute(this.opacities, 1));
        this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
        
        this.material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.NormalBlending,
            uniforms: {
                color: { value: new THREE.Color(0xaaff66) },
            },
            vertexShader: `
                attribute float opacity;
                attribute float size;
                varying float vOpacity;
                void main() {
                    vOpacity = opacity;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * (600.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform vec3 color;
                varying float vOpacity;
                void main() {
                    float dist = distance(gl_PointCoord, vec2(0.5));
                    if (dist > 0.5) discard;
                    float alpha = (1.0 - smoothstep(0.1, 0.5, dist)) * vOpacity;
                    gl_FragColor = vec4(color, alpha * 0.3); // Even thinner
                }
            `
        });
        
        this.points = new THREE.Points(this.geometry, this.material);
        this.points.name = "GasParticles";
        this.points.frustumCulled = false;
        this.scene.add(this.points);
        
        this.elapsedTime = 0;
    }

    resetParticle(i) {
        // If leaking is stopped, don't reactivate particles at the source
        if (!this.isLeaking && this.particles[i] && this.particles[i].active) {
            this.opacities[i] = 0;
            this.particles[i].active = false;
            return;
        }

        this.positions[i * 3] = this.startPosition.x + (Math.random() - 0.5) * 0.1;
        this.positions[i * 3 + 1] = this.startPosition.y + (Math.random() - 0.5) * 0.1;
        this.positions[i * 3 + 2] = this.startPosition.z + (Math.random() - 0.5) * 0.1;
        this.opacities[i] = 0;
        this.sizes[i] = Math.random() * 0.3 + 0.15;
        
        if (this.particles[i]) {
            this.particles[i].velocity.set(
                (Math.random() - 0.5) * 0.02,
                (Math.random() - 0.2) * 0.015,
                (Math.random() - 0.5) * 0.02
            );
            this.particles[i].active = false;
            this.particles[i].startTime = this.elapsedTime + Math.random() * 2;
        }
    }

    start() {
        this.isStarted = true;
        this.isLeaking = true;
    }

    stopLeaking() {
        this.isLeaking = false;
    }

    applyAirflow(sourcePos, strength) {
        if (!this.isStarted) return;
        
        for (let i = 0; i < this.particleCount; i++) {
            const p = this.particles[i];
            if (!p.active) continue;
            
            const px = this.positions[i * 3];
            const py = this.positions[i * 3 + 1];
            const pz = this.positions[i * 3 + 2];
            
            const dx = sourcePos.x - px;
            const dy = sourcePos.y - py;
            const dz = sourcePos.z - pz;
            const distSq = dx * dx + dy * dy + dz * dz;
            const dist = Math.sqrt(distSq);
            
            if (dist < 10.0) { // Larger suction radius
                const force = (1.0 - dist / 10.0) * strength;
                p.externalForce.x += (dx / dist) * force * 0.5;
                p.externalForce.y += (dy / dist) * force * 0.5;
                p.externalForce.z += (dz / dist) * force * 0.5;
                
                if (dist < 1.2) { // Particle disappears when inside vent
                    this.resetParticle(i);
                }
            }
        }
    }

    update(deltaTime) {
        if (!this.isStarted) return;

        this.elapsedTime += deltaTime;
        const positions = this.geometry.attributes.position.array;
        const opacities = this.geometry.attributes.opacity.array;
        
        for (let i = 0; i < this.particleCount; i++) {
            const p = this.particles[i];
            
            if (!p.active && this.isLeaking && this.elapsedTime > p.startTime) {
                p.active = true;
            }
            
            if (p.active) {
                p.velocity.add(p.externalForce);
                p.externalForce.multiplyScalar(0.6); // Stronger suction damping
                
                positions[i * 3] += p.velocity.x;
                positions[i * 3 + 1] += p.velocity.y;
                positions[i * 3 + 2] += p.velocity.z;
                
                p.velocity.x += (Math.random() - 0.5) * 0.001;
                p.velocity.y += (Math.random() - 0.5) * 0.001;
                p.velocity.z += (Math.random() - 0.5) * 0.001;
                
                p.velocity.multiplyScalar(0.95);
                
                if (opacities[i] < 0.15) {
                    opacities[i] += 0.03 * deltaTime;
                }
                
                // If leaking stopped, fade out particles that are not near vents
                if (!this.isLeaking && p.externalForce.lengthSq() < 0.001) {
                    opacities[i] -= 0.05 * deltaTime;
                    if (opacities[i] <= 0) {
                        p.active = false;
                    }
                }

                const limitX = 2.45;
                const limitZ = 2.45;
                const limitY = 2.95;
                
                if (Math.abs(positions[i * 3]) > limitX) {
                    positions[i * 3] = Math.sign(positions[i * 3]) * limitX;
                    p.velocity.x *= -0.05;
                }
                if (positions[i * 3 + 1] < 0 || positions[i * 3 + 1] > limitY) {
                    positions[i * 3 + 1] = Math.max(0, Math.min(positions[i * 3 + 1], limitY));
                    p.velocity.y *= -0.05;
                }
                if (Math.abs(positions[i * 3 + 2]) > limitZ) {
                    positions[i * 3 + 2] = Math.sign(positions[i * 3 + 2]) * limitZ;
                    p.velocity.z *= -0.05;
                }
            }
        }
        
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.opacity.needsUpdate = true;
    }
}
