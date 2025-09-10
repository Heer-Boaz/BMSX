import { $, World, CameraObject, new_vec3, V3, AmbientLightObject, DirectionalLightObject, PointLightObject } from 'bmsx';
import { bclass } from './bclass';
import { CameraController } from './camera_controller';
import { AnimatedMorphSphere, Cube3D, SmallCube3D } from './objects3d';
import { BitmapId } from './resourceids';

export function createTestromPlugin() {
  return {
    onBoot(model: World) {
      // Scene scaffold (ported from previous do_one_time_game_init)
      const cube = new Cube3D();
      const small = new SmallCube3D(1);
      const small2 = new SmallCube3D(2);
      const animatedMorphSphere = new AnimatedMorphSphere();
      world.spawn(new bclass(), new_vec3(100, 100, 1000));
      world.spawn(cube, new_vec3(0, 0, 0));
      world.spawn(small, new_vec3(5, 0, 0));
      world.spawn(small2, new_vec3(5, 5, 5));
      world.spawn(animatedMorphSphere, new_vec3(5, 5, 5));

      const cam1 = new CameraObject('cam1');
      cam1.camera.setAspect(world.gamewidth / world.gameheight);
      const cam2 = new CameraObject('cam2');
      cam2.camera.setAspect(world.gamewidth / world.gameheight);

      world.spawn(cam1, V3.of(-60, 48, 120));
      cam1.camera.screenLook(1.7687161091476518, -1.418966871448069, -2.6349415504373304);
      world.spawn(cam2, V3.of(5, 12, 27));
      world.activeCameraId = cam1.id;

      const ambient = new AmbientLightObject([1.0, 1.0, 1.0], 0.2, 'amb');
      const sun = new DirectionalLightObject([0.5, -1.0, -0.5], [1.0, 1.0, 1.0], 1, 'sun');
      const extraSun = new DirectionalLightObject([-0.5, -1.0, 0.5], [1.0, 1.0, 1.0], 1, 'extraSun');
      const lamp = new PointLightObject([2.0, 2.0, 2.0], [1.0, 1.0, 1.0], 6.0, 2, 'lamp');

      world.spawn(ambient);
      world.spawn(sun);
      world.spawn(extraSun);
      world.spawn(lamp);

      $.view.setSkybox({
        posX: BitmapId.skybox,
        negX: BitmapId.skybox,
        posY: BitmapId.skybox,
        negY: BitmapId.skybox,
        posZ: BitmapId.skybox,
        negZ: BitmapId.skybox,
      });

      world.spawn(new CameraController(cam1, cam2));
    }
  };
}
