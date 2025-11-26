-- NEW LUA RESOURCE
FUNCTION BLA(Y)
	WRITE('bla',Y,Y,0,10)
	IF Y % 20 == 0 THEN
		PRINT('[hotreload-test] bla y=' .. Y)
	END
END
