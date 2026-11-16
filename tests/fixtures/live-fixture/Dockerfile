FROM nl2repobench-pi:1.5.2
RUN python -m pip install --no-cache-dir pytest==8.4.2 attrs==25.4.0
COPY evaluator_tests.py /tests/test_live_fixture.py
ENTRYPOINT []
WORKDIR /workspace
CMD ["tail", "-f", "/dev/null"]
