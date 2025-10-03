// main.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';

/* -------------------------
   MinimalOutlinePass
------------------------- */
class MinimalOutlinePass extends Pass {
  constructor(resolution, scene, camera, selectedObjects) {
    super();
    this.resolution = resolution.clone();
    this.renderScene = scene;
    this.renderCamera = camera;
    this.selectedObjects = selectedObjects || [];
    this.renderTargetMaskBuffer = new THREE.WebGLRenderTarget(this.resolution.x, this.resolution.y);
    this.edgeDetectionMaterial = this.getEdgeDetectionMaterial();
    this.fsQuad = new FullScreenQuad(this.edgeDetectionMaterial);
  }
  setSize(w, h) {
    this.renderTargetMaskBuffer.setSize(w, h);
    this.edgeDetectionMaterial.uniforms.texSize.value.set(w, h);
  }
  render(renderer, writeBuffer, readBuffer) {
    if (!this.selectedObjects.length) return;
    const oldBackground = this.renderScene.background;
    this.renderScene.background = null;
    const oldVisible = [];
    this.renderScene.traverse(obj => {
      if (obj.isMesh) {
        oldVisible.push([obj, obj.visible]);
        obj.visible = this.selectedObjects.includes(obj);
      }
    });
    renderer.setRenderTarget(this.renderTargetMaskBuffer);
    renderer.clear();
    renderer.render(this.renderScene, this.renderCamera);
    oldVisible.forEach(([obj, v]) => (obj.visible = v));
    this.renderScene.background = oldBackground;
    this.edgeDetectionMaterial.uniforms.maskTexture.value = this.renderTargetMaskBuffer.texture;
    this.edgeDetectionMaterial.uniforms.sceneTexture.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
  getEdgeDetectionMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        maskTexture: { value: null },
        sceneTexture: { value: null },
        texSize: { value: new THREE.Vector2(this.resolution.x, this.resolution.y) },
        edgeColor: { value: new THREE.Color(0x000000) },
        outlineSize: { value: 1.0 }
      },
      vertexShader: `varying vec2 vUv;
        void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv;
        uniform sampler2D maskTexture;
        uniform sampler2D sceneTexture;
        uniform vec2 texSize;
        uniform vec3 edgeColor;
        uniform float outlineSize;
        void main(){
          vec2 invSize=outlineSize/texSize;
          vec4 sceneColor=texture2D(sceneTexture,vUv);
          float c=texture2D(maskTexture,vUv).r;
          float l=texture2D(maskTexture,vUv+vec2(-invSize.x,0)).r;
          float r=texture2D(maskTexture,vUv+vec2(invSize.x,0)).r;
          float u=texture2D(maskTexture,vUv+vec2(0,invSize.y)).r;
          float d=texture2D(maskTexture,vUv+vec2(0,-invSize.y)).r;
          float edge=step(0.1,abs(c-l)+abs(c-r)+abs(c-u)+abs(c-d));
          gl_FragColor = edge>0.0 ? vec4(edgeColor,1.0) : sceneColor;
        }`
    });
  }
}

/* -------------------------
   Setup
------------------------- */
let scene, camera, renderer, controls, composer, outlinePass, pixelPass;
let currentModel = null;
let ambientLight, directionalLights = [], lightGroup;
let container;

const modelList = ["test.glb","test2.glb","pilz.glb"];
const params = {
  model: modelList[0],
  wireframe: false,
  outlineColor: '#000000',
  outlineSize: 1,
  pixelation: 0,
  lightIntensity1: 10,
  lightIntensity2: 10,
  lightIntensity3: 10
};

init();
loadModel(params.model);
animate();

function init() {
  container = document.querySelector('.jscontainer');

  scene = new THREE.Scene();
  const aspect = container.clientWidth / container.clientHeight;
  camera = new THREE.PerspectiveCamera(20, aspect, 0.1, 2000);
  camera.position.set(0,30,60);

  renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene,camera));

  outlinePass = new MinimalOutlinePass(new THREE.Vector2(container.clientWidth, container.clientHeight), scene, camera);
  composer.addPass(outlinePass);

  const PixelShader = {
    uniforms: {
      tDiffuse:{value:null},
      resolution:{value:new THREE.Vector2(container.clientWidth, container.clientHeight)},
      pixelSize:{value:0}
    },
    vertexShader:`varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`uniform sampler2D tDiffuse; uniform vec2 resolution; uniform float pixelSize; varying vec2 vUv;
    void main(){
      if(pixelSize<=1.0){gl_FragColor=texture2D(tDiffuse,vUv);}
      else{vec2 dxy=pixelSize/resolution; vec2 coord=dxy*floor(vUv/dxy); gl_FragColor=texture2D(tDiffuse,coord);}
    }`
  };
  pixelPass = new ShaderPass(PixelShader);
  pixelPass.enabled = false;
  composer.addPass(pixelPass);

  composer.addPass(new SMAAPass(container.clientWidth, container.clientHeight));

  // Lights
  ambientLight = new THREE.AmbientLight(0xd9e3a6,0.5);
  scene.add(ambientLight);
  lightGroup = new THREE.Group();
  const radius=60, lightHeights=[40,0,5];
  const colors=[0xa8caff,0xffddaa,0xd9e3a6];
  for(let i=0;i<3;i++){
    const angle=i*(2*Math.PI/3);
    const light=new THREE.DirectionalLight(colors[i],10);
    light.position.set(radius*Math.cos(angle),lightHeights[i],radius*Math.sin(angle));
    lightGroup.add(light);
    lightGroup.add(light.target);
    directionalLights.push(light);
  }
  scene.add(lightGroup);

  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;

  buildGui();
  window.addEventListener('resize',onResize);
}

function buildGui(){
  const gui = new GUI({ container: container });
  gui.domElement.style.position = 'absolute';
  gui.domElement.style.top = '10px';
  gui.domElement.style.right = '10px';
  gui.domElement.style.zIndex = '20';

  gui.add(params,'model',modelList).onChange(v=>loadModel(v));
  gui.add(params,'wireframe').onChange(v=>{
    if(currentModel){
      currentModel.traverse(o=>{ if(o.isMesh){o.material.wireframe=v; o.material.needsUpdate=true;} });
    }
  });
  const fOutline=gui.addFolder('Outline');
  fOutline.addColor(params,'outlineColor').onChange(v=>{
    outlinePass.edgeDetectionMaterial.uniforms.edgeColor.value.set(v);
  });
  fOutline.add(params,'outlineSize',1,5,1).onChange(v=>{
    outlinePass.edgeDetectionMaterial.uniforms.outlineSize.value=v;
  });
  gui.add(params,'pixelation',0,30,1).onChange(v=>{
    pixelPass.enabled=v>0; pixelPass.uniforms.pixelSize.value=v;
  });
  const fLights=gui.addFolder('Lights');
  fLights.add(params,'lightIntensity1',0,50,1).onChange(v=>directionalLights[0].intensity=v);
  fLights.add(params,'lightIntensity2',0,50,1).onChange(v=>directionalLights[1].intensity=v);
  fLights.add(params,'lightIntensity3',0,50,1).onChange(v=>directionalLights[2].intensity=v);
}

function loadModel(modelName){
  const url=`https://www.8ty.one/models/${modelName}`;
  if(currentModel){scene.remove(currentModel); outlinePass.selectedObjects=[];}
  new GLTFLoader().load(url,gltf=>{
    currentModel=gltf.scene;
    currentModel.traverse(o=>{ if(o.isMesh) o.material.wireframe=params.wireframe; });
    scene.add(currentModel);
    const meshes=[]; currentModel.traverse(o=>{ if(o.isMesh) meshes.push(o); });
    outlinePass.selectedObjects=meshes;
    centerModel(currentModel);
  });
}

function centerModel(model){
  const box=new THREE.Box3().setFromObject(model);
  const center=box.getCenter(new THREE.Vector3());
  const size=box.getSize(new THREE.Vector3());
  model.position.sub(center);
  const maxDim=Math.max(size.x,size.y,size.z);
  const fov=camera.fov*(Math.PI/180);
  let cameraZ=Math.abs(maxDim/Math.sin(fov/2));
  camera.position.set(0,size.y*0.5,cameraZ);
  camera.lookAt(0,0,0);
  controls.target.set(0,0,0); controls.update();
}

function animate(){ requestAnimationFrame(animate); controls.update(); composer.render(); }
function onResize(){
  const w = container.clientWidth, h = container.clientHeight;
  camera.aspect = w/h; camera.updateProjectionMatrix();
  renderer.setSize(w,h);
  composer.setSize(w,h);
  outlinePass.setSize(w,h);
  pixelPass.uniforms.resolution.value.set(w,h);
}
