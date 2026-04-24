import * as THREE from 'three';

/**
 * GasDispersionSystem - Gaz Yayılım Sistemi
 * Odanın bilgisayarından başlayan ve zamanla tüm odayı dolduran gaz parçacıkları oluşturur.
 */
export class GasDispersionSystem {
    constructor(scene, startPosition) {
        this.scene = scene;
        this.startPosition = startPosition ? startPosition.clone() : new THREE.Vector3(0, 1.0, -1.8);
        this.particleCount = 5000;
        this.particles = [];
        this.isStarted = false;
        
        this.geometry = new THREE.BufferGeometry();
        this.positions = new Float32Array(this.particleCount * 3);
        this.opacities = new Float32Array(this.particleCount);
        this.sizes = new Float32Array(this.particleCount);
        
        for (let i = 0; i < this.particleCount; i++) {
            this.positions[i * 3] = this.startPosition.x;
            this.positions[i * 3 + 1] = this.startPosition.y;
            this.positions[i * 3 + 2] = this.startPosition.z;
            
            this.opacities[i] = 0; 
            this.sizes[i] = Math.random() * 0.4 + 0.2;
            
            this.particles.push({
                velocity: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.02,
                    (Math.random() - 0.2) * 0.015, 
                    (Math.random() - 0.5) * 0.02
                ),
                startTime: Math.random() * 5,
                active: false,
                externalForce: new THREE.Vector3(0, 0, 0)
            });
        }
        
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute('opacity', new THREE.BufferAttribute(this.opacities, 1));
        this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
        
        this.material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                color: { value: new THREE.Color(0x00ff00) }, // Canlı yeşil
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
                    gl_FragColor = vec4(color, alpha * 0.6);
                }
            `
        });
        
        this.points = new THREE.Points(this.geometry, this.material);
        this.points.name = "GasParticles";
        this.scene.add(this.points);
        
        this.elapsedTime = 0;
    }

    start() {
        this.isStarted = true;
    }

    applyAirflow(sourcePos, direction, strength) {
        if (!this.isStarted) return;
        
        const dir = direction.clone().normalize();
        
        for (let i = 0; i < this.particleCount; i++) {
            const p = this.particles[i];
            if (!p.active) continue;
            
            const currentPos = new THREE.Vector3(
                this.positions[i * 3],
                this.positions[i * 3 + 1],
                this.positions[i * 3 + 2]
            );
            
            // Kaynağa yakınlık kontrolü (Havalandırma etkisi mesafe ile azalır)
            const dist = currentPos.distanceTo(sourcePos);
            const influence = Math.max(0, 1.0 - dist / 5.0); // 5 metre etki alanı
            
            if (influence > 0) {
                p.externalForce.add(dir.clone().multiplyScalar(strength * influence * 0.1));
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
            
            if (!p.active && this.elapsedTime > p.startTime) {
                p.active = true;
            }
            
            if (p.active) {
                // Hız ve kuvvet uygulama
                p.velocity.add(p.externalForce);
                p.externalForce.multiplyScalar(0.9); // Kuvveti zamanla sönümle
                
                positions[i * 3] += p.velocity.x;
                positions[i * 3 + 1] += p.velocity.y;
                positions[i * 3 + 2] += p.velocity.z;
                
                // Türbülans
                p.velocity.x += (Math.random() - 0.5) * 0.001;
                p.velocity.y += (Math.random() - 0.5) * 0.001;
                p.velocity.z += (Math.random() - 0.5) * 0.001;
                
                // Hava direnci (yavaşlatma)
                p.velocity.multiplyScalar(0.99);
                
                // Görünürlük
                if (opacities[i] < 0.6) {
                    opacities[i] += 0.05 * deltaTime;
                }
                
                // Sınırlar
                const limitX = 2.4;
                const limitZ = 2.4;
                const limitY = 2.9;
                
                if (Math.abs(positions[i * 3]) > limitX) {
                    positions[i * 3] = Math.sign(positions[i * 3]) * limitX;
                    p.velocity.x *= -0.5;
                }
                if (positions[i * 3 + 1] < 0 || positions[i * 3 + 1] > limitY) {
                    positions[i * 3 + 1] = Math.max(0, Math.min(positions[i * 3 + 1], limitY));
                    p.velocity.y *= -0.5;
                }
                if (Math.abs(positions[i * 3 + 2]) > limitZ) {
                    positions[i * 3 + 2] = Math.sign(positions[i * 3 + 2]) * limitZ;
                    p.velocity.z *= -0.5;
                }
            }
        }
        
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.opacity.needsUpdate = true;
    }
}
