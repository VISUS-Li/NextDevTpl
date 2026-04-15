#!/usr/bin/env python3
"""NextDevTpl 镜像构建与部署入口。"""

from __future__ import annotations

import argparse
import os
import platform
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
SCRIPTS_DIR = PROJECT_ROOT / "scripts"
DEFAULT_CONFIG_FILE = SCRIPTS_DIR / "release.env"
DEFAULT_ENV_FILE = PROJECT_ROOT / ".env.release"

DEFAULTS = {
    "REGISTRY_DOMAIN": "crpi-dwpdx29dne1d4tyy.cn-chengdu.personal.cr.aliyuncs.com",
    "REGISTRY_USER": "1183989659@qq.com",
    "NAMESPACE": "visus",
    "IMAGE_NAME": "nextdevtpl",
    "CONTAINER_NAME": "nextdevtpl-app",
    "SERVER_URL": "https://platform.tripai.icu",
    "REDINK_PUBLIC_URL": "https://redink.tripai.icu",
    "APP_BIND_HOST": "127.0.0.1",
    "APP_PORT": "3000",
    "NETWORK_NAME": "nextdevtpl_net",
    "DB_CONTAINER_NAME": "nextdevtpl-postgres",
    "DB_VOLUME": "nextdevtpl_postgres",
    "DB_NAME": "nextdevtpl",
    "DB_USER": "postgres",
    "DB_PASSWORD": "postgres",
    "DB_PORT": "5432",
    "LOCAL_STORAGE_VOLUME": "nextdevtpl_storage",
}


def parse_env_file(path: Path) -> dict[str, str]:
    """读取简单的 env 配置。"""
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def load_config(config_file: Path) -> dict[str, str]:
    """合并默认值、配置文件和环境变量。"""
    file_config = parse_env_file(config_file)
    config = {key: file_config.get(key, value) for key, value in DEFAULTS.items()}
    for key in list(config):
        config[key] = os.environ.get(key, config[key])
    if os.environ.get("REGISTRY_PASSWORD"):
        config["REGISTRY_PASSWORD"] = os.environ["REGISTRY_PASSWORD"]
    elif file_config.get("REGISTRY_PASSWORD"):
        config["REGISTRY_PASSWORD"] = file_config["REGISTRY_PASSWORD"]
    else:
        config["REGISTRY_PASSWORD"] = ""
    return config


def run(command: list[str], cwd: Path = PROJECT_ROOT) -> None:
    """执行命令并直接透传输出。"""
    print("+", " ".join(command))
    subprocess.run(command, cwd=cwd, check=True)


def capture(command: list[str], cwd: Path = PROJECT_ROOT) -> str:
    """执行命令并返回标准输出。"""
    result = subprocess.run(
        command,
        cwd=cwd,
        check=True,
        text=True,
        capture_output=True,
    )
    return result.stdout.strip()


def docker_login_if_needed(config: dict[str, str], skip_login: bool) -> None:
    """按需登录镜像仓库。"""
    if skip_login:
        print("已跳过镜像仓库登录")
        return
    password = config.get("REGISTRY_PASSWORD", "")
    user = config.get("REGISTRY_USER", "")
    if not user or not password:
        print("未提供镜像仓库用户名或密码，默认使用本机已保存的 Docker 凭证")
        return
    print("+", f"docker login --username={user} {config['REGISTRY_DOMAIN']}")
    subprocess.run(
        [
            "docker",
            "login",
            f"--username={user}",
            config["REGISTRY_DOMAIN"],
            "--password-stdin",
        ],
        cwd=PROJECT_ROOT,
        check=True,
        text=True,
        input=password,
    )


def build_image(config: dict[str, str], version: str, skip_login: bool, skip_push: bool) -> None:
    """构建并按需推送镜像。"""
    full_image = f'{config["REGISTRY_DOMAIN"]}/{config["NAMESPACE"]}/{config["IMAGE_NAME"]}:{version}'
    print(f"准备构建镜像: {full_image}")
    docker_login_if_needed(config, skip_login)
    run(
        [
            "docker",
            "build",
            "--build-arg",
            f'BETTER_AUTH_URL={config["SERVER_URL"]}',
            "--build-arg",
            f'NEXT_PUBLIC_APP_URL={config["SERVER_URL"]}',
            "--build-arg",
            f'REDINK_PUBLIC_URL={config["REDINK_PUBLIC_URL"]}',
            "-t",
            full_image,
            ".",
        ]
    )
    if skip_push:
        print("已跳过镜像推送")
        return
    run(["docker", "push", full_image])


def find_docker_port_containers(port: str) -> list[str]:
    """查找占用指定宿主机端口的容器。"""
    result = subprocess.run(
        ["docker", "ps", "--format", "{{.Names}}\t{{.Ports}}"],
        text=True,
        capture_output=True,
        check=True,
    )
    marker = f":{port}->"
    return [
        line.split("\t", 1)[0]
        for line in result.stdout.splitlines()
        if marker in line
    ]


def find_listening_pids(port: str) -> list[str]:
    """查找占用指定端口的监听进程。"""
    system = platform.system()
    if system == "Windows":
        command = [
            "powershell",
            "-NoProfile",
            "-Command",
            (
                f"Get-NetTCPConnection -LocalPort {port} -State Listen "
                "| Select-Object -ExpandProperty OwningProcess -Unique"
            ),
        ]
        result = subprocess.run(command, text=True, capture_output=True, check=False)
        if result.returncode not in {0, 1}:
            raise subprocess.CalledProcessError(
                result.returncode,
                command,
                output=result.stdout,
                stderr=result.stderr,
            )
        return [pid.strip() for pid in result.stdout.splitlines() if pid.strip()]

    for command in (
        ["lsof", "-tiTCP:" + port, "-sTCP:LISTEN"],
        ["ss", "-ltnp", f"( sport = :{port} )"],
        ["netstat", "-ltnp"],
    ):
        try:
            result = subprocess.run(command, text=True, capture_output=True, check=False)
        except FileNotFoundError:
            continue
        if result.returncode not in {0, 1}:
            continue
        pids = sorted(set(re.findall(r"pid=(\d+)", result.stdout)))
        if pids:
            return pids or [
                pid.strip() for pid in result.stdout.splitlines() if pid.strip()
            ]
    return []


def stop_listening_process(pid: str) -> None:
    """停止本机监听进程。"""
    system = platform.system()
    command = (
        ["taskkill", "/PID", pid, "/F"]
        if system == "Windows"
        else ["kill", "-TERM", pid]
    )
    run(command)


def free_local_port(port: str, keep_containers: set[str] | None = None) -> None:
    """释放部署目标宿主机端口。"""
    keep_containers = keep_containers or set()
    for name in find_docker_port_containers(port):
        if name in keep_containers:
            continue
        print(f"检测到容器占用端口 {port}: {name}")
        run(["docker", "rm", "-f", name])
    for pid in find_listening_pids(port):
        print(f"检测到进程占用端口 {port}: {pid}")
        stop_listening_process(pid)


def ensure_env_file(path: Path, config: dict[str, str]) -> None:
    """生成并同步最小运行配置。"""
    existing = parse_env_file(path) if path.exists() else {}
    db_url = (
        f'postgresql://{config["DB_USER"]}:{config["DB_PASSWORD"]}'
        f'@{config["DB_CONTAINER_NAME"]}:{config["DB_PORT"]}/{config["DB_NAME"]}'
    )
    env_values = {
        "NODE_ENV": "production",
        "DATABASE_URL": db_url,
        "BETTER_AUTH_SECRET": existing.get("BETTER_AUTH_SECRET", secrets.token_hex(32)),
        "CONFIG_SECRET_KEY": existing.get("CONFIG_SECRET_KEY", secrets.token_hex(32)),
        "BETTER_AUTH_URL": config["SERVER_URL"],
        "NEXT_PUBLIC_APP_URL": config["SERVER_URL"],
        "REDINK_PUBLIC_URL": config["REDINK_PUBLIC_URL"],
        "STORAGE_PROVIDER": "local",
        "LOCAL_STORAGE_DIR": "/app/.local-storage",
    }
    path.write_text(
        "\n".join([f"{key}={value}" for key, value in env_values.items()]) + "\n",
        encoding="utf-8",
    )
    print(f"已同步部署环境文件: {path}")


def container_exists(name: str) -> bool:
    """判断容器是否已经存在。"""
    result = subprocess.run(
        ["docker", "ps", "-a", "--format", "{{.Names}}"],
        text=True,
        capture_output=True,
        check=True,
    )
    return name in result.stdout.splitlines()


def container_running(name: str) -> bool:
    """判断容器当前是否正在运行。"""
    if not container_exists(name):
        return False
    return capture(["docker", "inspect", "--format", "{{.State.Running}}", name]) == "true"


def network_exists(name: str) -> bool:
    """判断 Docker 网络是否存在。"""
    result = subprocess.run(
        ["docker", "network", "ls", "--format", "{{.Name}}"],
        text=True,
        capture_output=True,
        check=True,
    )
    return name in result.stdout.splitlines()


def ensure_network(name: str) -> None:
    """确保应用网络存在。"""
    if network_exists(name):
        return
    run(["docker", "network", "create", name])


def ensure_postgres(config: dict[str, str]) -> None:
    """确保 PostgreSQL 容器已启动。"""
    ensure_network(config["NETWORK_NAME"])
    name = config["DB_CONTAINER_NAME"]
    if container_exists(name):
        if not container_running(name):
            run(["docker", "start", name])
    else:
        # 平台站点默认依赖 PostgreSQL，这里把数据库容器一并带起来。
        run(
            [
                "docker",
                "run",
                "-d",
                "--name",
                name,
                "--network",
                config["NETWORK_NAME"],
                "--restart",
                "unless-stopped",
                "-e",
                f'POSTGRES_DB={config["DB_NAME"]}',
                "-e",
                f'POSTGRES_USER={config["DB_USER"]}',
                "-e",
                f'POSTGRES_PASSWORD={config["DB_PASSWORD"]}',
                "-v",
                f'{config["DB_VOLUME"]}:/var/lib/postgresql/data',
                "--health-cmd",
                f'pg_isready -U {config["DB_USER"]} -d {config["DB_NAME"]}',
                "--health-interval",
                "5s",
                "--health-timeout",
                "5s",
                "--health-retries",
                "20",
                "postgres:16-alpine",
            ]
        )
    wait_container_healthy(name)


def wait_container_healthy(name: str, timeout_seconds: int = 90) -> None:
    """等待容器健康检查通过。"""
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        status = capture(["docker", "inspect", "--format", "{{.State.Health.Status}}", name])
        if status == "healthy":
            return
        if status == "unhealthy":
            raise RuntimeError(f"容器健康检查失败: {name}")
        time.sleep(2)
    raise RuntimeError(f"等待容器健康检查超时: {name}")


def wait_http(url: str, timeout_seconds: int = 120) -> None:
    """等待 HTTP 服务可访问。"""
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                if response.status in {200, 307, 308}:
                    return
        except Exception:
            time.sleep(2)
            continue
        time.sleep(2)
    raise RuntimeError(f"等待服务超时: {url}")


def deploy_image(
    config: dict[str, str],
    version: str,
    skip_login: bool,
    skip_pull: bool,
    env_file: Path,
) -> None:
    """拉取镜像并启动容器。"""
    full_image = f'{config["REGISTRY_DOMAIN"]}/{config["NAMESPACE"]}/{config["IMAGE_NAME"]}:{version}'
    print(f"准备部署镜像: {full_image}")
    docker_login_if_needed(config, skip_login)
    ensure_env_file(env_file, config)
    ensure_postgres(config)
    if not skip_pull:
        run(["docker", "pull", full_image])
    else:
        print("已跳过镜像拉取")

    container_name = config["CONTAINER_NAME"]
    if container_exists(container_name):
        run(["docker", "rm", "-f", container_name])
    free_local_port(config["APP_PORT"], {container_name})

    run(
        [
            "docker",
            "run",
            "-d",
            "--name",
            container_name,
            "--network",
            config["NETWORK_NAME"],
            "--restart",
            "unless-stopped",
            "--env-file",
            str(env_file),
            "-e",
            "PORT=3000",
            "-p",
            f'{config["APP_BIND_HOST"]}:{config["APP_PORT"]}:3000',
            "-v",
            f'{config["LOCAL_STORAGE_VOLUME"]}:/app/.local-storage',
            full_image,
        ]
    )

    wait_http(f'http://127.0.0.1:{config["APP_PORT"]}')
    run(["docker", "ps", "--filter", f"name={container_name}"])
    run(["docker", "logs", "--tail", "80", container_name])


def release_image(
    config: dict[str, str],
    version: str,
    skip_login: bool,
    env_file: Path,
) -> None:
    """一键完成构建、推送和部署。"""
    build_image(config, version, skip_login, False)
    deploy_image(config, version, skip_login, False, env_file)


def parse_args() -> argparse.Namespace:
    """解析命令行参数。"""
    parser = argparse.ArgumentParser(description="NextDevTpl Docker 部署入口")
    subparsers = parser.add_subparsers(dest="command", required=True)

    build_parser = subparsers.add_parser("build", help="构建并按需推送镜像")
    build_parser.add_argument("version", nargs="?", default="latest")
    build_parser.add_argument("--skip-login", action="store_true")
    build_parser.add_argument("--skip-push", action="store_true")
    build_parser.add_argument("--config-file", default=str(DEFAULT_CONFIG_FILE))

    deploy_parser = subparsers.add_parser("deploy", help="拉取并部署镜像")
    deploy_parser.add_argument("version", nargs="?", default="latest")
    deploy_parser.add_argument("--skip-login", action="store_true")
    deploy_parser.add_argument("--skip-pull", action="store_true")
    deploy_parser.add_argument("--config-file", default=str(DEFAULT_CONFIG_FILE))
    deploy_parser.add_argument("--env-file", default=str(DEFAULT_ENV_FILE))

    release_parser = subparsers.add_parser("release", help="构建、推送并部署镜像")
    release_parser.add_argument("version", nargs="?", default="latest")
    release_parser.add_argument("--skip-login", action="store_true")
    release_parser.add_argument("--config-file", default=str(DEFAULT_CONFIG_FILE))
    release_parser.add_argument("--env-file", default=str(DEFAULT_ENV_FILE))
    return parser.parse_args()


def main() -> int:
    """程序入口。"""
    args = parse_args()
    config = load_config(Path(args.config_file))
    if args.command == "build":
        build_image(config, args.version, args.skip_login, args.skip_push)
        return 0
    if args.command == "release":
        release_image(config, args.version, args.skip_login, Path(args.env_file))
        return 0
    deploy_image(
        config,
        args.version,
        args.skip_login,
        args.skip_pull,
        Path(args.env_file),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
