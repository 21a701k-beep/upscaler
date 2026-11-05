# /// script
# requires-python = ">=3.10"
# dependencies = ["torch", "torchvision", "spandrel", "onnx", "onnxconverter-common"]
#
# # CPU-only builds: the default Linux wheels pull in gigabytes of CUDA libraries.
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# torchvision = { index = "pytorch-cpu" }
#
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
import urllib.request
from pathlib import Path

import onnx
import torch
from onnxconverter_common import float16
from spandrel import ModelLoader

RELEASES = "https://github.com/xinntao/Real-ESRGAN/releases/download"
WEIGHTS = {
    "public/esrgan_x4.onnx": [f"{RELEASES}/v0.1.0/RealESRGAN_x4plus.pth"],
    "public/esrgan_x2.onnx": [f"{RELEASES}/v0.2.1/RealESRGAN_x2plus.pth"],
    # The compact model at Real-ESRGAN's default denoise strength of 0.5, which interpolates its strong-
    # and weak-denoise weights halfway.
    "public/esrgan_compact_x4.onnx": [
        f"{RELEASES}/v0.2.5.0/realesr-general-x4v3.pth",
        f"{RELEASES}/v0.2.5.0/realesr-general-wdn-x4v3.pth",
    ],
}


def load(url):
    weights = Path(url.rsplit("/", 1)[1])
    if not weights.exists():
        urllib.request.urlretrieve(url, weights)
    return ModelLoader().load_from_file(weights).model.eval()


Path("public").mkdir(exist_ok=True)

for onnx_name, urls in WEIGHTS.items():
    model, *others = [load(url) for url in urls]
    if others:
        states = [m.state_dict() for m in (model, *others)]
        model.load_state_dict({key: sum(s[key] for s in states) / len(states) for key in states[0]})

    torch.onnx.export(
        model,
        torch.rand(1, 3, 64, 64),
        onnx_name,
        dynamo=False,
        opset_version=17,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {2: "h", 3: "w"}, "output": {2: "h_out", 3: "w_out"}},
    )
    print(f"wrote {onnx_name}")

    # Half-precision copy for GPUs with shader-f16: about half the weights and GPU memory. Input and
    # output stay float32, so the app feeds both variants the same tensors.
    fp16_name = onnx_name.replace(".onnx", "_fp16.onnx")
    onnx.save(float16.convert_float_to_float16(onnx.load(onnx_name), keep_io_types=True), fp16_name)
    print(f"wrote {fp16_name}")
