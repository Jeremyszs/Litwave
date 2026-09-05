import asyncio
from concurrent.futures import ThreadPoolExecutor

# Dedicated ThreadPoolExecutor for heavy MIR analysis so the async event loop never freezes
_ANALYSIS_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="LitwaveAnalysis")

def run_in_executor(func, *args, **kwargs):
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(_ANALYSIS_EXECUTOR, lambda: func(*args, **kwargs))
